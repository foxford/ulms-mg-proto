import mqtt from 'mqtt';
import { MQTT_URL } from './constants';

const REQUEST_TIMEOUT = 5000;

export default class UlmsClient {
  constructor(meAgentId, mqttPassword) {
    this.client = null;
    this.clientHandleId = null;
    this.pendingTransactions = {};
    this.meAgentId = meAgentId;
    this.mqttPassword = mqttPassword;
    this.services = [];
  }

  registerService(serviceAccountId, serviceClientBuilder) {
    this.services.push({
      serviceAccountId,
      serviceClient: serviceClientBuilder(this._buildServiceCallbacks(serviceAccountId))
    });
  }

  _buildServiceCallbacks(serviceAccountId) {
    return {
      meAgentId: () => this.meAgentId,
      callMethod: async (method, payload) => {
        return await this.callMethod(serviceAccountId, method, payload);
      },
    };
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.client = new mqtt.connect(MQTT_URL, {
        clientId: this.meAgentId,
        password: this.mqttPassword,
        username: '',
        keepalive: 10,
        properties: {
          userProperties: {
            connection_mode: 'default',
            connection_version: 'v2',
          },
        },
        protocolVersion: 5,
        reconnectPeriod: 0
      });

      this.client.on('message', this._handleMessage.bind(this))

      this.client.on('connect', async evt => {
        for (let { serviceAccountId } of this.services) {
          this.client.subscribe(this._inTopic(serviceAccountId), async err => {
            return err ? reject(err) : resolve();
          });
        }
      });

      this.client.on('offline', evt => this.onDisconnect && this.onDisconnect(evt));
    });
  }

  async callMethod(serviceAccountId, method, payload) {
    let response = await this._makeRequest(serviceAccountId, method, payload);
    let status = parseInt(response.properties.userProperties.status);

    if (status >= 200 && status < 300) {
      return response.payload;
    } else {
      throw `${status} ${response.payload.title}: ${response.payload.detail} (${response.properties.userProperties.correlationData})`;
    }
  }

  async _makeRequest(serviceAccountId, method, payload) {
    let correlationData = Math.random().toString(36).substr(2, 10);

    let promise = new Promise((resolve, reject) => {
      let timeoutHandle = setTimeout(() => {
        delete this.pendingTransactions[correlationData];
        reject(`Request with correlation data '${correlationData}' timed out`);
      }, REQUEST_TIMEOUT);

      this.pendingTransactions[correlationData] = { resolve, timeoutHandle };
    });

    let properties = {
      responseTopic: this._inTopic(serviceAccountId),
      correlationData,
      userProperties: {
        type: 'request',
        method,
        local_timestamp: new Date().getTime().toString(),
      },
    };

    let outTopic = this._outTopic(serviceAccountId);
    console.debug('Outgoing message', outTopic, payload, properties);
    this.client.publish(outTopic, JSON.stringify(payload), { properties });
    return promise;
  }

  _handleMessage(topic, payloadBytes, packet) {
    let correlationData = packet.properties.correlationData;
    let payload = JSON.parse(payloadBytes);
    console.debug('Incoming message', payload, packet.properties);

    switch (packet.properties.userProperties.type) {
      case 'response':
        if (this.pendingTransactions[correlationData]) {
          let { resolve, timeoutHandle } = this.pendingTransactions[correlationData];
          clearInterval(timeoutHandle);
          delete this.pendingTransactions[correlationData];
          resolve({ payload, properties: packet.properties });
        }

        break;

      case 'event':
        for (let { serviceClient } of this.services) {
          if (typeof(serviceClient.handleEvent) !== 'function') continue;
          serviceClient.handleEvent(payload, packet.properties, topic);
        }

        break;
    }
  }

  _inTopic(serviceAccountId) {
    return `agents/${this.meAgentId}/api/v1/in/${serviceAccountId}`;
  }

  _outTopic(serviceAccountId) {
    return `agents/${this.meAgentId}/api/v1/out/${serviceAccountId}`;
  }
}
