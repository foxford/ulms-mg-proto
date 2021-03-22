import mqtt from 'mqtt';
import { MQTT_URL, CONFERENCE_ACCOUNT_ID } from './constants';

const REQUEST_TIMEOUT = 60000;

export default class ConferenceClient {
  constructor(meAgentId, mqttPassword) {
    this.client = null;
    this.clientHandleId = null;
    this.pendingTransactions = {};
    this.meAgentId = meAgentId;
    this.mqttPassword = mqttPassword;
    this.inTopic = `agents/${this.meAgentId}/api/v1/in/${CONFERENCE_ACCOUNT_ID}`;
    this.outTopic = `agents/${this.meAgentId}/api/v1/out/${CONFERENCE_ACCOUNT_ID}`;
    this.onRtcStreamUpdateCallback = null;
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
        this.client.subscribe(this.inTopic, async err => err ? reject(err) : resolve());
      });

      this.client.on('offline', evt => this.onDisconnect && this.onDisconnect(evt));
    });
  }

  onRtcStreamUpdate(callback) {
    this.onRtcStreamUpdateCallback = callback;
  }

  async readRoom(roomId) {
    return await this._callMethod('room.read', { id: roomId });
  }

  async enterRoom(roomId) {
    return await this._callMethod('room.enter', { id: roomId });

    // let promise = new Promise((resolve, reject) => {
    //   let timeoutHandle = setTimeout(() => {
    //     delete this.pendingTransactions.roomEntrance;
    //     reject('Room entrance timed out');
    //   }, REQUEST_TIMEOUT);

    //   this.pendingTransactions.roomEntrance = { resolve, timeoutHandle };
    // });

    // let properties = {
    //   responseTopic: this.inTopic,
    //   correlationData: Math.random().toString(36).substr(2, 10),
    //   userProperties: {
    //     type: 'request',
    //     method: 'room.enter',
    //     local_timestamp: new Date().getTime().toString(),
    //   },
    // };

    // let payload = { id: roomId };
    // console.debug('Outgoing message', payload, properties);
    // this.client.publish(this.outTopic, JSON.stringify(payload), { properties });
    // await promise;
  }

  async listRtc(roomId) {
    return await this._callMethod('rtc.list', { room_id: roomId });
  }

  async createRtc(roomId) {
    return await this._callMethod('rtc.create', { room_id: roomId });
  }

  async connectToRtc(rtcId, intent) {
    return await this._callMethod('rtc.connect', { id: rtcId, intent });
  }

  async createRtcSignal(handleId, jsep) {
    return await this._callMethod('rtc_signal.create', { handle_id: handleId, jsep, label: 'mg-proto' });
  }

  async listRtcStreams(roomId, offset, limit) {
    return await this._callMethod('rtc_stream.list', { room_id: roomId, offset, limit });
  }

  async _callMethod(method, payload) {
    let response = await this._makeRequest(method, payload);
    let status = parseInt(response.properties.userProperties.status);

    if (status >= 200 && status < 300) {
      return response.payload;
    } else {
      throw `${status} ${response.payload.title}: ${response.payload.detail} (${response.properties.userProperties.correlationData})`;
    }
  }

  async _makeRequest(method, payload) {
    let correlationData = Math.random().toString(36).substr(2, 10);

    let promise = new Promise((resolve, reject) => {
      let timeoutHandle = setTimeout(() => {
        delete this.pendingTransactions[correlationData];
        reject(`Request with correlation data '${correlationData}' timed out`);
      }, REQUEST_TIMEOUT);

      this.pendingTransactions[correlationData] = { resolve, timeoutHandle };
    });

    let properties = {
      responseTopic: this.inTopic,
      correlationData,
      userProperties: {
        type: 'request',
        method,
        local_timestamp: new Date().getTime().toString(),
      },
    };

    console.debug('Outgoing message', payload, properties);
    this.client.publish(this.outTopic, JSON.stringify(payload), { properties });
    return promise;
  }

  _handleMessage(_topic, payloadBytes, packet) {
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
        switch (packet.properties.userProperties.label) {
          // case 'room.enter':
          //   if (payload.agent_id === this.meAgentId) {
          //     let { resolve, timeoutHandle } = this.pendingTransactions.roomEntrance;
          //     clearInterval(timeoutHandle);
          //     delete this.pendingTransactions.roomEntrance;
          //     resolve();
          //   }

          case 'rtc_stream.update':
            if (this.onRtcStreamUpdateCallback) this.onRtcStreamUpdateCallback(payload);
            break;
        }

        break;
    }
  }
}
