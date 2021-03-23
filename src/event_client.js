export default class EventClient {
  constructor(ulmsClientCallbacks) {
    this.ulmsClientCallbacks = ulmsClientCallbacks;
    this.onEventCreateCallback = null;
  }

  onEventCreate(callback) {
    this.onEventCreateCallback = callback;
  }

  async enterRoom(roomId) {
    return await this.ulmsClientCallbacks.callMethod('room.enter', { id: roomId });
  }

  async createEvent(roomId, type, set, data) {
    return await this.ulmsClientCallbacks.callMethod('event.create', {
      room_id: roomId,
      type,
      set,
      data
    });
  }

  async readState(roomId, sets) {
    return await this.ulmsClientCallbacks.callMethod('state.read', {
      room_id: roomId,
      sets,
    });
  }

  async handleEvent(payload, properties, _topic) {
    switch (properties.userProperties.label) {
      case 'event.create':
        if (this.onEventCreateCallback) this.onEventCreateCallback(payload);
        break;
    }
  }
}
