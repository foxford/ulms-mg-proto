export default class ConferenceClient {
  constructor(ulmsClientCallbacks) {
    this.ulmsClientCallbacks = ulmsClientCallbacks;
    this.onRtcCrateCallback = null;
    this.onRtcStreamUpdateCallback = null;
    this.onAgentWriterConfigUpdateCallback = null;
  }

  onRtcCreate(callback) {
    this.onRtcCreateCallback = callback;
  }

  onRtcStreamUpdate(callback) {
    this.onRtcStreamUpdateCallback = callback;
  }

  onAgentWriterConfigUpdate(callback) {
    this.onAgentWriterConfigUpdateCallback = callback;
  }

  async readRoom(roomId) {
    return await this.ulmsClientCallbacks.callMethod('room.read', { id: roomId });
  }

  async enterRoom(roomId) {
    return await this.ulmsClientCallbacks.callMethod('room.enter', { id: roomId });
  }

  async listRtc(roomId, offset, limit) {
    return await this.ulmsClientCallbacks.callMethod('rtc.list', {
      room_id: roomId,
      offset,
      limit
    });
  }

  async createRtc(roomId) {
    return await this.ulmsClientCallbacks.callMethod('rtc.create', { room_id: roomId });
  }

  async connectToRtc(rtcId, intent) {
    return await this.ulmsClientCallbacks.callMethod('rtc.connect', { id: rtcId, intent });
  }

  async createRtcSignal(handleId, jsep) {
    return await this.ulmsClientCallbacks.callMethod('rtc_signal.create', {
      handle_id: handleId,
      jsep,
      label: 'mg-proto'
    });
  }

  async listRtcStreams(roomId, offset, limit) {
    return await this.ulmsClientCallbacks.callMethod('rtc_stream.list', {
      room_id: roomId,
      offset,
      limit
    });
  }

  async readReaderConfig(roomId) {
    return await this.ulmsClientCallbacks.callMethod('agent_reader_config.read', {
      room_id: roomId,
      reader_id: this.ulmsClientCallbacks.meAgentId(),
    });
  }

  async updateReaderConfig(roomId, configs) {
    return await this.ulmsClientCallbacks.callMethod('agent_reader_config.update', {
      room_id: roomId,
      reader_id: this.ulmsClientCallbacks.meAgentId(),
      configs
    })
  }

  async readWriterConfig(roomId) {
    return await this.ulmsClientCallbacks.callMethod('agent_writer_config.read', { room_id: roomId});
  }

  async updateWriterConfig(roomId, configs) {
    return await this.ulmsClientCallbacks.callMethod('agent_writer_config.update', {
      room_id: roomId,
      configs
    })
  }

  async handleEvent(payload, properties, _topic) {
    switch (properties.userProperties.label) {
      case 'rtc.create':
        if (this.onRtcCreateCallback) this.onRtcCreateCallback(payload);
        break;

      case 'rtc_stream.update':
        if (this.onRtcStreamUpdateCallback) this.onRtcStreamUpdateCallback(payload);
        break;

      case 'agent_writer_config.update':
        if (this.onAgentWriterConfigUpdateCallback) this.onAgentWriterConfigUpdateCallback(payload);
        break;
    }
  }
}
