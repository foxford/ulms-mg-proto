import PcManager from './pc_manager';

export default class ViewerManager {
  constructor(conferenceClient, pinVideoComponent, regularVideoComponents) {
    this.viewers = {};
    this.conferenceClient = conferenceClient;
    this.pinVideoComponent = pinVideoComponent;
    this.regularVideoComponents = regularVideoComponents;
  }

  connectLocalStream(rtc, stream) {
    let videoComponent = this._findFreeVideoComponent();
    videoComponent.setRtcId(rtc.id);
    this.viewers[rtc.id] = { videoComponent };
    videoComponent.setStream(stream, true);
  }

  async connect(rtc) {
    let videoComponent = this._findFreeVideoComponent();
    videoComponent.setRtcId(rtc.id);

    if (!videoComponent) {
      console.warn('No free video components available');
      return;
    }

    let handleId = (await this.conferenceClient.connectToRtc(rtc.id, 'read')).handle_id;
    let pcManager = new PcManager();
    
    pcManager.onTrackAdded(evt => {
      if (evt.streams && evt.streams[0]) {
        videoComponent.setStream(evt.streams[0], false);
      } else {
        let stream = new MediaStream();
        stream.addTrack(evt.track);
        videoComponent.setStream(stream, false);
      }
    });

    pcManager.onIceCandidatesBufferFlush(candidates => {
      this.conferenceClient.createRtcSignal(handleId, candidates);
    });

    pcManager.onStats(report => {
      let videoComponent = this.getVideoComponent(rtc.id);
      if(videoComponent) videoComponent.setStats(report);
    });

    this.viewers[rtc.id] = { videoComponent, pcManager };

    let sdpOffer = await pcManager.getSdpOffer(false);
    let sdpAnswer = (await this.conferenceClient.createRtcSignal(handleId, sdpOffer)).jsep;
    pcManager.setSdpAnswer(sdpAnswer);
  }

  disconnect(rtcId) {
    let videoComponent = this.getVideoComponent(rtcId);
    if (videoComponent) videoComponent.reset();
    if (this.viewers[rtcId].pcManager) this.viewers[rtcId].pcManager.close();
    delete this.viewers[rtcId];
  }

  isConnected(rtcId) {
    return !!this.viewers[rtcId];
  }

  getVideoComponent(rtcId) {
    return this.viewers[rtcId] && this.viewers[rtcId].videoComponent;
  }

  togglePin(newPinRtcId) {
    let oldPinRtcId = this.pinVideoComponent.getRtcId();
    if (newPinRtcId === oldPinRtcId) return;

    let regularVideoComponent = this.viewers[newPinRtcId].videoComponent;
    this.pinVideoComponent.swap(regularVideoComponent);

    this.viewers[newPinRtcId].videoComponent = this.pinVideoComponent;

    if (this.viewers[oldPinRtcId]) {
      this.viewers[oldPinRtcId].videoComponent = regularVideoComponent;
    }
  }

  applyAgentReaderConfig(rtcId, config) {
    let videoComponent = this.getVideoComponent(rtcId);
    if (videoComponent) videoComponent.applyAgentReaderConfig(config);
  }

  applyAgentWriterConfig(rtcId, config) {
    let videoComponent = this.getVideoComponent(rtcId);
    if (videoComponent) videoComponent.applyAgentWriterConfig(config);
  }

  _findFreeVideoComponent() {
    return this.regularVideoComponents.find(videoComponent => videoComponent.isFree());
  }
}
