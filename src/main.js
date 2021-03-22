'use strict';

import { CONSTRAINTS, USR_AUDIENCE } from './constants';
import ConferenceClient from './conference_client';
import PcManager from './pc_manager';

class App {
  constructor(roomId, accountLabel, mqttPassword) {
    this.roomId = roomId;
    this.room = null;
    this.ownedRtc = null;
    this.publisher = null;
    this.viewers = {};

    let meAgentLabel = 'mg-proto-' + Math.random().toString(36).substr(2, 10);
    this.meAgentId = `${meAgentLabel}.${accountLabel}.${USR_AUDIENCE}`;
    this.conferenceClient = new ConferenceClient(this.meAgentId, mqttPassword);
    this.conferenceClient.onRtcStreamUpdate(async event => await this._onRtcStreamUpdate(event));
  }

  async connect() {
    await this.conferenceClient.connect();
  }

  async enterRoom() {
    this.room = await this.conferenceClient.readRoom(this.roomId);

    if (this.room.rtc_sharing_policy != 'owned') {
      throw `Room ${this.roomId} is not a minigroup room`;
    }

    await this.conferenceClient.enterRoom(this.roomId);
  }

  async initOwnedRtc() {
    let rtcs = await this.conferenceClient.listRtc(this.roomId);
    this.ownedRtc = rtcs.find(rtc => rtc.created_by === this.meAgentId);

    if (!this.ownedRtc) {
      this.ownedRtc = await this.conferenceClient.createRtc(this.roomId);
    }
  }

  async startStreaming() {
    let ownedHandleId = (await this.conferenceClient.connectToRtc(this.ownedRtc.id, 'write')).handle_id;
    this.publisher = new PcManager();

    const stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
    let videoEl = document.getElementById('video0');
    videoEl.srcObject = stream;
    videoEl.muted = true;
    this.publisher.addTracks(stream);

    let sdpOffer = await this.publisher.getSdpOffer(true);
    let sdpAnswer = (await this.conferenceClient.createRtcSignal(ownedHandleId, sdpOffer)).jsep;
    this.publisher.setSdpAnswer(sdpAnswer);

    this.publisher.onIceCandidatesBufferFlush(candidates => {
      this.conferenceClient.createRtcSignal(ownedHandleId, candidates);
    });
  }

  async connectToRunningStreams() {
    for (let offset = 0; offset < 10000; offset += 25) {
      let rtcStreams = await this.conferenceClient.listRtcStreams(this.roomId, offset, 25);
      if (rtcStreams.length === 0) break;

      for (let rtcStream of rtcStreams) {
        if (rtcStream.rtc_id !== this.ownedRtc.id &&
          rtcStream.time &&
          rtcStream.time[0] &&
          !rtcStream.time[1]) {
          this._connectViewer(rtcStream.rtc_id);
        }
      }
    }
  }

  async _onRtcStreamUpdate(event) {
    if (event.rtc_id === this.ownedRtc.id) return;

    if (event.time[1]) {
      if (this.viewers[event.rtc_id]) this._disconnectViewer(event.rtc_id);
    } else {
      this._connectViewer(event.rtc_id);
    }
  }

  async _connectViewer(rtcId) {
    let handleId = (await this.conferenceClient.connectToRtc(rtcId, 'read')).handle_id;
    let viewer = new PcManager();

    viewer.onTrackAdded(evt => {
      if (this.viewers[rtcId].videoEl && this.viewers[rtcId].videoEl.srcObject) return;
      let videoEl;

      // Find first unused video element and take it.
      for (let i = 1; i < 16; i++) {
        let el = document.getElementById(`video${i}`);

        if (!el.srcObject) {
          videoEl = el;
          break;
        }
      }

      if (!videoEl) {
        console.warn('No free video slots available');
        return;
      }

      if (evt.streams && evt.streams[0]) {
        console.log('ADD VIEWER STREAM', evt.streams[0], videoEl);
        videoEl.srcObject = evt.streams[0];
      } else {
        console.log('ADD VIEWER TRACK', evt.track, videoEl);
        let stream = new MediaStream();
        videoEl.srcObject = stream;
        stream.addTrack(evt.track);
      }

      this.viewers[rtcId].videoEl = videoEl;
    });

    viewer.onIceCandidatesBufferFlush(candidates => {
      this.conferenceClient.createRtcSignal(handleId, candidates);
    });

    let sdpOffer = await viewer.getSdpOffer(false);
    let sdpAnswer = (await this.conferenceClient.createRtcSignal(handleId, sdpOffer)).jsep;
    viewer.setSdpAnswer(sdpAnswer);

    this.viewers[rtcId] = { viewer, videoEl: null };
  }

  _disconnectViewer(rtcId) {
    let videoEl = this.viewers[rtcId].videoEl;
    if (videoEl) videoEl.srcObject = null;
    this.viewers[rtcId].viewer.close();
    delete this.viewers[rtcId];
  }
}

document.addEventListener('DOMContentLoaded', async function () {
  let params = new URLSearchParams(document.location.search.substring(1));

  let roomId = params.get("room_id");
  if (!roomId) throw 'Missing `room_id` query string parameter';

  let accountLabel = params.get("account_label");
  if (!accountLabel) throw 'Missing `account_label` query string parameter';

  let mqttPassword = params.get("mqtt_password");
  if (!roomId) throw 'Missing `mqtt_password` query string parameter';

  let app = new App(roomId, accountLabel, mqttPassword);
  await app.connect();
  await app.enterRoom();
  await app.initOwnedRtc();
  await app.startStreaming();
  await app.connectToRunningStreams();
});

for (let btnEl of document.getElementsByClassName('mute-btn')) {
  btnEl.addEventListener('click', evt => {
    let videoEl = document.getElementById(evt.target.dataset.id);
    if (!videoEl.srcObject) return;
    let audioTracks = videoEl.srcObject.getAudioTracks();
    if (!audioTracks[0]) return;
    audioTracks[0].enabled = !audioTracks[0].enabled;
  });
}
