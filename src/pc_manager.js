import { ICE_SERVERS } from './constants';
import { transformOfferSDP } from './sdp';

const ICE_CANDIDATES_BUFFER_FLUSH_PERIOD = 200;

export default class PcManager {
  constructor() {
    this.onStreamAddedCallback = null;
    this.iceCandidatesBuffer = [];
    this.iceCandidatesBufferFlushCallback = null;

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

  onTrackAdded(callback) {
    this.onTrackAddedCallback = callback;
  }

  addTracks(stream) {
    stream.getTracks().forEach(track => this.pc.addTrack(track, stream));
  }

  async getSdpOffer(isPublisher) {
    let sdpOffer = await this.pc.createOffer({
      offerToReceiveVideo: !isPublisher,
      offerToReceiveAudio: !isPublisher,
      iceRestart: true
    })

    sdpOffer.sdp = transformOfferSDP(sdpOffer.sdp);
    this.pc.setLocalDescription(sdpOffer);
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
}
