import PcManager from './pc_manager';

export default class ViewerManager {
  constructor(conferenceClient, leaderVideoComponent, regularVideoComponents) {
    this.viewers = {};
    this.conferenceClient = conferenceClient;
    this.leaderVideoComponent = leaderVideoComponent;
    this.regularVideoComponents = regularVideoComponents;
  }

  connectLocalStream(rtcId, stream) {
    let videoComponent = this._findFreeVideoComponent();
    videoComponent.setRtcId(rtcId);
    this.viewers[rtcId] = { videoComponent };
    videoComponent.setStream(stream, true);
  }

  async connect(rtcId) {
    let videoComponent = this._findFreeVideoComponent();
    videoComponent.setRtcId(rtcId);

    if (!videoComponent) {
      console.warn('No free video components available');
      return;
    }

    let handleId = (await this.conferenceClient.connectToRtc(rtcId, 'read')).handle_id;
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
      let videoComponent = this.getVideoComponent(rtcId);
      if(videoComponent) videoComponent.setStats(report);
    });

    this.viewers[rtcId] = { videoComponent, pcManager };

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

  toggleLeader(newLeaderRtcId) {
    let oldLeaderRtcId = this.leaderVideoComponent.getRtcId();
    if (newLeaderRtcId === oldLeaderRtcId) return;

    let regularVideoComponent = this.viewers[newLeaderRtcId].videoComponent;
    this.leaderVideoComponent.swap(regularVideoComponent);

    this.viewers[newLeaderRtcId].videoComponent = this.leaderVideoComponent;

    if (this.viewers[oldLeaderRtcId]) {
      this.viewers[oldLeaderRtcId].videoComponent = regularVideoComponent;
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
