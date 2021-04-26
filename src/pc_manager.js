import { ICE_SERVERS, VIDEO_CONSTRAINTS_REGULAR, VIDEO_CONSTRAINTS_PIN } from './constants';
import { transformOfferSDP } from './sdp';

const ICE_CANDIDATES_BUFFER_FLUSH_PERIOD = 200;
const STATS_INTERVAL = 1000;

export default class PcManager {
  constructor() {
    this.isPublisher = false;
    this.onStatsCallback = null;
    this.onStreamAddedCallback = null;
    this.iceCandidatesBuffer = [];
    this.iceCandidatesBufferFlushCallback = null;
    this.statsInterval = null;
    this.lastStats = { video: { bytesCount: 0 }, audio: { bytesCount: 0 } };

    this.iceCandidatesBufferFlushInterval = setInterval(() => {
      this._flushIceCandidatesBuffer();
    }, ICE_CANDIDATES_BUFFER_FLUSH_PERIOD);

    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc.onicecandidate = evt => this.iceCandidatesBuffer.push(evt.candidate);
    this.pc.ontrack = evt => this.onTrackAddedCallback && this.onTrackAddedCallback(evt);

    this.pc.oniceconnectionstatechange = _evt => {
      if (this.pc.iceConnectionState === "failed" && this.pc.restartIce) this.pc.restartIce();
    }
  }

  onStats(callback) {
    if (callback) {
      this.onStatsCallback = callback;
      this.statsInterval = setInterval(this._updateStats.bind(this), STATS_INTERVAL);
    } else {
      this.onStatsCallback = null;
      clearInterval(this.statsInterval);
    }
  }

  onTrackAdded(callback) {
    this.onTrackAddedCallback = callback;
  }

  addTracks(stream) {
    stream.getTracks().forEach(track => this.pc.addTrack(track, stream));
  }

  togglePinConstraints(isPin) {
    let constraints = isPin ? VIDEO_CONSTRAINTS_PIN : VIDEO_CONSTRAINTS_REGULAR;
    let sender = this.pc.getSenders().find(sender => sender.track.kind === 'video');

    if (sender) {
      sender.track.applyConstraints(constraints);
    } else {
      console.error("Failed to apply constraints. Video track not found");
    }
  }

  async getSdpOffer(isPublisher) {
    let sdpOffer = await this.pc.createOffer({
      offerToReceiveVideo: !isPublisher,
      offerToReceiveAudio: !isPublisher,
      iceRestart: true
    })

    sdpOffer.sdp = transformOfferSDP(sdpOffer.sdp);
    this.pc.setLocalDescription(sdpOffer);
    this.isPublisher = isPublisher;
    console.debug(`SDP offer (isPublisher = ${isPublisher})`, sdpOffer);
    return sdpOffer;
  }

  setSdpAnswer(sdpAnswer) {
    let answer = new RTCSessionDescription(sdpAnswer);
    console.debug(`SDP answer`, answer);
    this.pc.setRemoteDescription(answer);
  }

  onIceCandidatesBufferFlush(callback) {
    this.iceCandidatesBufferFlushCallback = callback;
  }

  _flushIceCandidatesBuffer() {
    if (!this.iceCandidatesFlushCallback) return;
    if (this.iceCandidatesBuffer.length === 0) return;

    let lastIceCandidate = this.iceCandidatesBuffer[this.iceCandidatesBuffer.length - 1];
    if (!lastIceCandidate) clearInterval(this.iceCandidatesBufferFlushInterval);

    this.iceCandidatesBufferFlushCallback(this.iceCandidatesBuffer);
    this.iceCandidatesBuffer = [];
  }

  close() {
    this.pc.close();
  }

  async _updateStats() {
    if (!this.onStatsCallback) return;
    let stats = {};
    
    for (let transceiver of this.pc.getTransceivers()) {
      if (this.isPublisher) {
        let report = await transceiver.sender.getStats();
        let statsObject = Array.from(report.values()).find(s => s.type === 'outbound-rtp');
        if (!statsObject) return;
        stats[statsObject.kind] = { bytesCount: statsObject.bytesSent };
      } else if (transceiver.receiver) {
        let report = await transceiver.receiver.getStats();
        let statsObject = Array.from(report.values()).find(s => s.type === 'inbound-rtp');
        if (!statsObject) return;
        stats[statsObject.kind] = { bytesCount: statsObject.bytesReceived };
      }
    }

    if (!stats.video || !stats.audio) return;
    
    let report = {
      videoBitrate: (stats.video.bytesCount - this.lastStats.video.bytesCount) * 8,
      audioBitrate: (stats.audio.bytesCount - this.lastStats.audio.bytesCount) * 8
    }

    this.lastStats = stats;
    this.onStatsCallback(report);
  }
}
