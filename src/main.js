'use strict';

import { CONSTRAINTS, USR_AUDIENCE, CONFERENCE_ACCOUNT_ID, EVENT_ACCOUNT_ID, VIDEO_REMBS } from './constants';
import UlmsClient from './ulms_client';
import ConferenceClient from './conference_client';
import EventClient from './event_client';
import PcManager from './pc_manager';
import VideoComponent from './video_component';
import ViewerManager from './viewer_manager';

class App {
  constructor(config, leaderVideoEl, regularVideoEls) {
    this.conferenceRoomId = config.conferenceRoomId;
    this.eventRoomId = config.eventRoomId;

    this.rtcs = [];
    this.ownedRtc = null;
    this.publisher = null;

    this._initUlmsClient(config.agentLabel, config.accountLabel, config.mqttPassword);
    this._initLeaderVideoComponent(leaderVideoEl);
    this._initRegularVideoComponents(regularVideoEls);
    this._initViewerManager();
  }

  _initUlmsClient(agentLabel, accountLabel, mqttPassword) {
    this.meAgentId = `${agentLabel}.${accountLabel}.${USR_AUDIENCE}`;
    this.ulmsClient = new UlmsClient(this.meAgentId, mqttPassword);

    this.ulmsClient.registerService(CONFERENCE_ACCOUNT_ID, ulmsClientCallbacks => {
      this.conferenceClient = new ConferenceClient(ulmsClientCallbacks);
      this.conferenceClient.onRtcCreate(event => this._onRtcCreate(event));
      this.conferenceClient.onRtcStreamUpdate(async event => await this._onRtcStreamUpdate(event));
      this.conferenceClient.onAgentWriterConfigUpdate(({ configs }) => this._applyAgentWriterConfigs(configs));
      return this.conferenceClient;
    });

    this.ulmsClient.registerService(EVENT_ACCOUNT_ID, ulmsClientCallbacks => {
      this.eventClient = new EventClient(ulmsClientCallbacks);
      this.eventClient.onEventCreate(event => this._onEventCreate(event));
      return this.eventClient;
    });
  }

  _initLeaderVideoComponent(el) {
    this.leaderVideoComponent = new VideoComponent(el);

    this.leaderVideoComponent.onMuteVideoForMe(async (rtcId, value) => {
      await this._updateAgentReaderConfig({[rtcId]: { receive_video: !value }});
    });

    this.leaderVideoComponent.onMuteVideoForAll(async (rtcId, value) => {
      await this._updateAgentWriterConfig({[rtcId]: { send_video: !value }});
    });

    this.leaderVideoComponent.onMuteAudioForMe(async (rtcId, value) => {
      await this._updateAgentReaderConfig({[rtcId]: { receive_audio: !value }});
    });

    this.leaderVideoComponent.onMuteAudioForAll(async (rtcId, value) => {
      await this._updateAgentWriterConfig({[rtcId]: { send_audio: !value }});
    });
  }

  _initRegularVideoComponents(els) {
    this.regularVideoComponents = Array.from(els).map(el => {
      let videoComponent = new VideoComponent(el);

      videoComponent.onMakeLeader(async rtcId => {
        let oldLeaderRtcId = this.leaderVideoComponent.getRtcId();
        await this._createLeaderEvent(rtcId);

        let configs = {
          [rtcId]: { video_remb: VIDEO_REMBS.leader }
        };

        if (oldLeaderRtcId) {
          configs[oldLeaderRtcId] = {
            video_remb: VIDEO_REMBS.regular,
          };
        }

        await this._updateAgentWriterConfig(configs);
      });

      videoComponent.onMuteVideoForMe(async (rtcId, value) => {
        await this._updateAgentReaderConfig({[rtcId]: { receive_video: !value }});
      });

      videoComponent.onMuteVideoForAll(async (rtcId, value) => {
        await this._updateAgentWriterConfig({[rtcId]: { send_video: !value }});
      });

      videoComponent.onMuteAudioForMe(async (rtcId, value) => {
        await this._updateAgentReaderConfig({[rtcId]: { receive_audio: !value }});
      });

      videoComponent.onMuteAudioForAll(async (rtcId, value) => {
        await this._updateAgentWriterConfig({[rtcId]: { send_audio: !value }});
      });

      return videoComponent;
    });
  }

  _initViewerManager() {
    this.viewerManager = new ViewerManager(
      this.conferenceClient,
      this.leaderVideoComponent,
      this.regularVideoComponents,
    );
  }

  async connect() {
    await this.ulmsClient.connect();
  }

  async enterConferenceRoom() {
    this.conferenceRoom = await this.conferenceClient.readRoom(this.conferenceRoomId);

    if (this.conferenceRoom.rtc_sharing_policy != 'owned') {
      throw `Room ${this.conferenceRoomId} has wrong RTC sharing policy`;
    }

    await this.conferenceClient.enterRoom(this.conferenceRoomId);
  }

  async enterEventRoom() {
    await this.eventClient.enterRoom(this.eventRoomId);
  }

  async initOwnedRtc() {
    for (let offset = 0; offset < 10000; offset += 25) {
      let rtcs = await this.conferenceClient.listRtc(this.conferenceRoomId, offset, 25);
      if (rtcs.length === 0) break;
      this.rtcs.push(...rtcs);
    }

    this.ownedRtc = this.rtcs.find(rtc => rtc.created_by === this.meAgentId);

    if (!this.ownedRtc) {
      this.ownedRtc = await this.conferenceClient.createRtc(this.conferenceRoomId);
      this.rtcs.push(this.ownedRtc);

      await this._updateAgentWriterConfig({[this.ownedRtc.id]: {
        send_video: true,
        send_audio: true,
        video_remb: VIDEO_REMBS.regular
      }});
    }
  }

  async startStreaming() {
    let connectResponse = await this.conferenceClient.connectToRtc(this.ownedRtc.id, 'write');
    let ownedHandleId = connectResponse.handle_id;
    this.publisher = new PcManager();

    this.publisher.onStats(report => {
      let videoComponent = this.viewerManager.getVideoComponent(this.ownedRtc.id);
      if (videoComponent) videoComponent.setStats(report);
    });

    const stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
    this.viewerManager.connectLocalStream(this.ownedRtc.id, stream);
    this.publisher.addTracks(stream);

    let sdpOffer = await this.publisher.getSdpOffer(true);
    let sdpAnswer = (await this.conferenceClient.createRtcSignal(ownedHandleId, sdpOffer)).jsep;
    this.publisher.setSdpAnswer(sdpAnswer);

    this.publisher.onIceCandidatesBufferFlush(candidates => {
      this.conferenceClient.createRtcSignal(ownedHandleId, candidates);
    });
  }

  async connectToRunningStreams() {
    let promises = [];

    for (let offset = 0; offset < 10000; offset += 25) {
      let rtcStreams = await this.conferenceClient.listRtcStreams(this.conferenceRoomId, offset, 25);
      if (rtcStreams.length === 0) break;

      for (let rtcStream of rtcStreams) {
        if (rtcStream.rtc_id !== this.ownedRtc.id &&
          rtcStream.time &&
          rtcStream.time[0] &&
          !rtcStream.time[1]) {
          promises.push(this.viewerManager.connect(rtcStream.rtc_id));
        }
      }
    }

    for (let promise of promises) await promise;
  }

  async fetchAgentReaderConfig() {
    let response = await this.conferenceClient.readReaderConfig(this.conferenceRoomId);

    for (let config of response.configs) {
      let rtc = this.rtcs.find(rtc => rtc.created_by === config.agent_id);
      if (rtc) this.viewerManager.applyAgentReaderConfig(rtc.id, config);
    }
  }

  async fetchAgentWriterConfig() {
    let response = await this.conferenceClient.readWriterConfig(this.conferenceRoomId);
    this._applyAgentWriterConfigs(response.configs);
  }

  _applyAgentWriterConfigs(configs) {
    for (let config of configs) {
      let rtc = this.rtcs.find(rtc => rtc.created_by === config.agent_id);
      if (rtc) this.viewerManager.applyAgentWriterConfig(rtc.id, config);
    }
  }

  async fetchLeader() {
    let response = await this.eventClient.readState(this.eventRoomId, ['leader']);
    
    if (response.leader.data) {
      this._toggleLeader(response.leader.data.rtcId);
    }
  }

  _toggleLeader(leaderRtcId) {
    let oldLeaderRtcId = this.leaderVideoComponent.getRtcId();
    if (!this.viewerManager.isConnected(leaderRtcId)) return;

    let ownedRtcId = this.ownedRtc && this.ownedRtc.id;

    if (leaderRtcId === ownedRtcId) {
      this.publisher.toggleLeaderConstraints(true);
    } else if (oldLeaderRtcId === ownedRtcId) {
      this.publisher.toggleLeaderConstraints(false);
    }

    this.viewerManager.toggleLeader(leaderRtcId);
  }

  async _createLeaderEvent(rtcId) {
    await this.eventClient.createEvent(this.eventRoomId, 'leader', 'leader', { rtcId });
  }

  async _updateAgentReaderConfig(configs) {
    let agentConfigs = this._buildAgentConfigs(configs);
    await this.conferenceClient.updateReaderConfig(this.conferenceRoomId, agentConfigs);
  }

  async _updateAgentWriterConfig(configs) {
    let agentConfigs = this._buildAgentConfigs(configs);
    await this.conferenceClient.updateWriterConfig(this.conferenceRoomId, agentConfigs);
  }

  _buildAgentConfigs(configs) {
    return Object.entries(configs).map(([rtcId, config]) => {
      let rtc = this.rtcs.find(rtc => rtc.id === rtcId);
      if (!rtc) throw `Failed to build agent config. RTC ${rtcId} not found.`;
      return {agent_id: rtc.created_by, ...config}
    });
  }

  //////////////////////////////////////////////////////////////////////////////

  _onRtcCreate(rtc) {
    if (!this.rtcs.find(r => r.id === rtc.id)) this.rtcs.push(rtc);
  }

  async _onRtcStreamUpdate(event) {
    if (this.ownedRtc && event.rtc_id === this.ownedRtc.id) return;

    if (event.time[1]) {
      // Stream stopped.
      if (this.viewerManager.isConnected(event.rtc_id)) {
        this.viewerManager.disconnect(event.rtc_id);
      }
    } else {
      // Stream started.
      await this.viewerManager.connect(event.rtc_id);
      if (event.rtc_id === this.leaderVideoComponent.getRtcId()) this._toggleLeader(event.rtc_id);
    }
  }

  _onEventCreate(event) {
    if (event.type === 'leader' && event.set === 'leader') {
      this._toggleLeader(event.data.rtcId);
    }
  }
}

////////////////////////////////////////////////////////////////////////////////

document.addEventListener('DOMContentLoaded', async function () {
  let config = {};
  let params = new URLSearchParams(document.location.search.substring(1));

  config.conferenceRoomId = params.get("conference_room_id");
  if (!config.conferenceRoomId) throw 'Missing `conference_room_id` query string parameter';

  config.eventRoomId = params.get("event_room_id");
  if (!config.eventRoomId) throw 'Missing `event_room_id` query string parameter';

  config.accountLabel = params.get("account_label");
  if (!config.accountLabel) throw 'Missing `account_label` query string parameter';

  config.mqttPassword = params.get("mqtt_password");
  if (!config.mqttPassword) throw 'Missing `mqtt_password` query string parameter';

  config.agentLabel = window.localStorage.getItem('mg-proto-agent-label');

  if (!config.agentLabel) {
    config.agentLabel = 'mg-proto-' + Math.random().toString(36).substr(2, 10);
    window.localStorage.setItem('mg-proto-agent-label', config.agentLabel);
  }

  let leaderVideoEl = document.getElementsByClassName('video-component leader')[0];
  let regularVideoEls = document.getElementsByClassName('video-component regular');
  let app = new App(config, leaderVideoEl, regularVideoEls);

  await app.connect();
  await app.enterConferenceRoom();
  await app.enterEventRoom();
  await app.initOwnedRtc();
  await app.startStreaming();
  await app.connectToRunningStreams();
  await app.fetchLeader();
  await app.fetchAgentReaderConfig();
  await app.fetchAgentWriterConfig();
});
