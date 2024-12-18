#!/usr/bin/env node

import dotenv from 'dotenv';
import { expand } from 'dotenv-expand';

expand(dotenv.config());

import os from 'os';
import * as Mqtt from 'mqtt';
import MQTTPattern from 'mqtt-pattern';
import axios from 'axios';
axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';

import moment from 'moment-timezone';
import momentDurationFormatSetup from 'moment-duration-format';

momentDurationFormatSetup(moment);
typeof moment.duration.fn.format === 'function';
typeof moment.duration.format === 'function';

import Play from 'play-sound';
let player = new Play({'player':'mpg123'});
var audio = undefined;

import ziggyJs from 'ziggy-js';

async function loadZiggy() {
  console.log('Loading Ziggy data');
  try {
    const response = await axios.get(process.env.APP_URL + '/api/ziggy');
    return await response.data;
  } catch (error) {
    console.error(error);
  }
}

const Ziggy = await loadZiggy();
let route = (name, params, absolute, config = Ziggy) => ziggyJs(name, params, absolute, config);

const roomSlug = process.env.ROOM_SLUG;
const roomScreenName = process.env.ROOM_SCREEN_NAME;
const defaultVolume = process.env.DEFAULT_VOLUME;
const storeName = process.env.STORE_NAME;

const pinPlay = parseInt(process.env.PIN_PLAY);
const pinLoop = parseInt(process.env.PIN_LOOP);
const pinStop = parseInt(process.env.PIN_STOP);
const pinEnded = parseInt(process.env.PIN_ENDED);
const pinTrackBit0 = parseInt(process.env.PIN_TRACK_BIT_0);
const pinTrackBit1 = parseInt(process.env.PIN_TRACK_BIT_1);
const pinTrackBit2 = parseInt(process.env.PIN_TRACK_BIT_2);
const pinTrackBit3 = parseInt(process.env.PIN_TRACK_BIT_3);

const TRACK_CORRECT = 13;
const TRACK_INCORRECT = 14;

console.log('Room Slug: ' + roomSlug);
console.log('Room Screen Name: ' + roomScreenName);
console.log('Store Name: ' + storeName);
console.log('Default volume: ' + defaultVolume);

import { Gpio } from '@bratbit/onoff';

let endedOut;
let playIn;
let loopIn;
let stopIn;
let trackBit0In;
let trackBit1In;
let trackBit2In;
let trackBit3In;
let endedTimeout = null;

if (true) { //Gpio.Gpio.accessible) {
  console.log('Gpio: using real ended');
  endedOut = new Gpio(pinEnded, 'out');
  playIn = new Gpio(pinPlay, 'in', 'rising', {debounceTimeout: 10});
  loopIn = new Gpio(pinLoop, 'in');
  stopIn = new Gpio(pinStop, 'in', 'rising', {debounceTimeout: 10});
  trackBit0In = new Gpio(pinTrackBit0, 'in');
  trackBit1In = new Gpio(pinTrackBit1, 'in');
  trackBit2In = new Gpio(pinTrackBit2, 'in');
  trackBit3In = new Gpio(pinTrackBit3, 'in');

  playIn.watch(playWatch);
  stopIn.watch(stopWatch);
} else {
  console.log('Gpio: using virtual ended');
  endedOut = {
    write: value => {
      console.log('Ended: virtual ended now uses value: ' + value);
    },
    unexport: () => {
      //
    },
  };
}

endedOut.write(1);

process.on('SIGINT', _ => {
  playIn.unwatchAll();
  stopIn.unwatchAll();

  endedOut.unexport();
  playIn.unexport();
  stopIn.unexport();
  loopIn.unexport();
  trackBit0In.unexport();
  trackBit1In.unexport();
  trackBit2In.unexport();
  trackBit3In.unexport();

  endedOut = undefined;
  playIn = undefined;
  stopIn = undefined;
  loopIn = undefined;
  trackBit0In = undefined;
  trackBit1In = undefined;
  trackBit2In = undefined;
  trackBit3In = undefined;

  mqttClient.end(true);

  process.exit();
});

let defaultData = {
  room: null,
  clues: null,
  events: null,
  roomState: null,
  duration: null,
  start: null,
  gameState: null,
  currentTimeInterval: null,
  currentTime: moment(),
  escapeTime: null,
  failTime: null,
  clueTimeout: null,
  clueHtml: null,
  audioPath: null,
  playingPath: null,
  playAudio: false,
  playLooped: false,
  puzzleData: [],
  correctTrack: 0,
  incorrectTrack: 0,
};

let currentData = JSON.parse(JSON.stringify(defaultData));
currentData.currentTime = moment();

async function loadRoomData() {
  console.log('Loading Room Data');
  await axios.get(route('api.rooms.show', roomSlug))
      .then(response => {
        if (response.status == 200) {
          currentData.room = response.data;
          console.log('Loaded Room Data');
        }
      })
      .catch(error => {
        console.log('fetchRoom: Error', error);
      });

  const request = {
    key_by_id: 1,
  };

  await axios.get(route('api.rooms.clues.index', roomSlug), {params: request})
      .then(response => {
        if (response.status == 200) {
          currentData.clues = response.data;
          console.log('Loaded Clues');
        }
      })
      .catch(error => {
        console.log('fetchClues: Error', error);
      });

  await axios.get(route('api.rooms.game-events.index', roomSlug), {params: request})
      .then(response => {
        if (response.status == 200) {
          currentData.events = response.data;
          console.log('Loaded GameEvents');
        }
      })
      .catch(error => {
        console.log('fetchGameEvents: Error', error);
      });
}

await loadRoomData();

// let clientId = mqtt.options.clientId;
const clientId = 'mqttjs_' + Math.random().toString(16).substr(2, 8);
const localIp = Object.values(os.networkInterfaces()).flat().find(i => i.family == 'IPv4' && !i.internal).address;
const presenceTopic = 'tempus/room/' + roomSlug + '/presence/' + clientId;
const presencePayload = {
    component: roomScreenName,
    state: 'WILL',
};
const puzzleLogTopic = 'tempus/room/' + roomSlug + '/puzzle/' + roomScreenName + '/log';
const storeTopicPrefix = 'tempus/puzzle-data/' + storeName + '/';

const mqttOptions = {
    will:{
        topic: presenceTopic,
        payload: undefined,
        retain: true,
        qos: 0,
    },
};

const mqttClient  = Mqtt.connect('mqtt://' + process.env.MQTT_HOST + ':' + process.env.MQTT_PORT, mqttOptions);
// 'ws://' + process.env.MIX_MQTT_HOST + ':' + process.env.MIX_MQTT_PORT +'/mqtt'

const mqttTopics = {
  'tempus/room/+roomSlug/room-state' (data, packet, topic) {
    if (topic != 'tempus/room/' + roomSlug + '/room-state') {
      return;
    }

    let payload = data.length ? JSON.parse(data) : null;
    console.log('room-state', payload);
    currentData.roomState = payload;
  },

  'tempus/room/+roomSlug/duration' (data, packet, topic) {
    if (topic != 'tempus/room/' + roomSlug + '/duration') {
      return;
    }

    let payload = data.length ? JSON.parse(data) : null;
    console.log('duration', payload);
    currentData.duration = payload;
  },

  'tempus/room/+roomSlug/start' (data, packet, topic) {
    if (topic != 'tempus/room/' + roomSlug + '/start') {
      return;
    }

    let payload = data.length ? JSON.parse(data) : null;
    console.log('start', payload);
    currentData.start = payload;
  },

  'tempus/room/+roomSlug/game-state' (data, packet, topic) {
    if (topic != 'tempus/room/' + roomSlug + '/game-state') {
      return;
    }

    let payload = data.length ? JSON.parse(data) : null;
    console.log('game-state', payload);
    currentData.gameState = payload;

    if (currentData.gameState == null) {
      stopAudio();
    } else {
      switch (currentData.gameState.state) {
        case 'R':
          stopAudio();
          break;
        case 'SS':
          stopAudio();
          break;
        case 'S':

          break;
        case 'E':
          stopAudio();

          break;
        case 'F':
          stopAudio();

          break;
        default:
          break;
      }
    }
  },

  'tempus/room/+roomSlug/clue' (data, packet, topic) {
    if (topic != 'tempus/room/' + roomSlug + '/clue') {
      return;
    }

    let payload = data.length ? JSON.parse(data) : null;
    console.log('clue', payload);

    clueReceived(payload);
  },

  'tempus/room/+roomSlug/event' (data, packet, topic) {
    if (topic != 'tempus/room/' + roomSlug + '/event') {
      return;
    }

    let payload = data.length ? JSON.parse(data) : null;
    console.log('event', payload);

    eventReceived(payload);
  },

  'tempus/room/+roomSlug/music' (data, packet, topic) {
    if (topic != 'tempus/room/' + roomSlug + '/music') {
      return;
    }

    let payload = data.length ? JSON.parse(data) : null;
    console.log('music', payload);
  },

  'tempus/puzzle-data/+storeName/+key' (data, packet, topic) {
    if (! topic.startsWith(storeTopicPrefix)) {
      return;
    }

    let topicSplits = topic.split(storeTopicPrefix);
    let key = topicSplits[1];
    let payload = data.length ? JSON.parse(data) : null;
    console.log('puzzle-data', key, payload);

    currentData.puzzleData[key] = payload;
  },
};

mqttClient.on('connect', function () {
  console.log('MQTT: Connect');
  presencePayload.state = 'ONLINE';
  presencePayload.ip = localIp;
  presencePayload.timestamp = moment();
  mqttClient.publish(presenceTopic, JSON.stringify(presencePayload), {retain: true});

  mqttClient.subscribe(
    Object.keys(mqttTopics).map(topic => MQTTPattern.fill(topic, {roomSlug: roomSlug, storeName: storeName, key: '+'}))
  );
});

mqttClient.on('message', function (topic, message, packet) {
  // message is Buffer
  Object.keys(mqttTopics).forEach(pattern => {
    if (MQTTPattern.matches(pattern, topic)) {
      mqttTopics[pattern](message, packet, topic);
    }
  });
})

function endTime() {
  if (currentData.start == null || currentData.duration == null) {
    return null;
  }

  return moment(currentData.start.start).add(currentData.duration.duration, 'minutes');
}

function countdownTime() {
  currentData.endTime = endTime();
  let countdownTime = 'TIME GOES HERE';
  if (currentData.start && currentData.gameState && currentData.duration) {
    switch (currentData.gameState.state) {
      case 'R':
        countdownTime = 'Ready To Start';
        break;
      case 'SS':
        countdownTime = 'Briefing';
        break;
      case 'S':
        let duration = moment.duration(currentData.endTime.diff(currentData.currentTime));
        if (duration < 0) {
          countdownTime = '-' + moment.duration(currentData.currentTime.diff(currentData.endTime)).format('mm:ss', 1) + ' GAME OVER';
        } else if (duration > 600000) {
          countdownTime = duration.format('mm:ss');
        } else {
          countdownTime = duration.format('mm:ss', 1);
        }

        break;
      case 'E':
        countdownTime = moment.duration(currentData.endTime.diff(currentData.escapeTime)).format('mm:ss', 1) + ' GAME OVER';
        break;
      case 'F':
        countdownTime = moment.duration(currentData.endTime.diff(currentData.failTime)).format('mm:ss', 1) + ' GAME OVER';
        break;
      default:
        break;
    }
  }

  return countdownTime;
}

// Ticking Clock
currentData.currentTimeInterval = setInterval(() => {
  currentData.currentTime = moment();
}, 100);

function clueReceived(clue) {
  console.log('clueReceived(clue)', clue);

  if (! clue.audioPath) {
    return;
  }

  if (! clue.options.hasOwnProperty('screen')) {
    return;
  }

  if (clue.options.screen != roomScreenName) {
    return;
  }

  // playAudio(clue);
}

function eventReceived(event) {
  console.log('eventReceived(event)', event);
  switch (event.event) {
    default:
      break;
  }
}

function recoverStateFromGame() {
  log('recoverStateFromGame()');
  let eventGameTimelines = currentData.game.game_timelines.filter(gameTimeline => gameTimeline.game_event_id != null)
  // console.log('recoverStateFromGame()', eventGameTimelines);

  eventGameTimelines.forEach(gameTimeline => {
    switch (gameTimeline.game_event.event) {
      default:
        break;
    }
  });
}

function fetchGame(gameId) {
  log('fetchGame(gameId)', gameId);

  axios.get(route('api.games.show', gameId))
    .then(response => {
      if (response.status == 200) {
        currentData.game = response.data;
        recoverStateFromGame();
      }
    })
    .catch(error => {
      // flash('Error fetching Game', 'danger');
      if (error.response) {
        // if HTTP_UNPROCESSABLE_ENTITY some validation error laravel or us
        if (error.response.status == 422) {
          console.log('fetchGame: laravel validation error', error.response.data);
        }
        // else if HTTP_CONFLICT
        // else if HTTP_FORBIDDEN on enough permissions
        if (error.response.status == 401) {
          // else if HTTP_UNAUTHORIZED not authorized
          console.log('fetchGame:401', error.response.data);
        }
        console.log('fetchGame: Response error', error.response.data, error.response.status, error.response.headers);
      } else if (error.request) {
        // The request was made but no response was received
        // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
        // http.ClientRequest in node.js
        console.error('fetchGame: Request error', error.request);
      } else {
        // Something happened in setting up the request that triggered an Error
        console.error('fetchGame: Error', error.message);
      }
    });
}

function sendEvent(eventCode, options = {}) {
  log('sendEvent(eventCode, options)', eventCode, options);
  let event = Object.values(currentData.events).find(event => event.event == eventCode);

  if (event == null) {
    log('sendEvent: code ' + eventCode + ' not found!');

    return;
  }

  let eventPayload = {
    timestamp: moment(),
    eventId: event.id,
    event: event.event,
    message: event.description,
    options: {
      source: 'auto',
      bypass: false,
      ...options,
    },
  };

  mqttClient.publish('tempus/room/' + this.room.slug + '/event', JSON.stringify(eventPayload));
}


function readTrack() {
  let track;

  track |= (trackBit0In.readSync() << 0);
  track |= (trackBit1In.readSync() << 1);
  track |= (trackBit2In.readSync() << 2);
  track |= (trackBit3In.readSync() << 3);

  return track;
}

function readLooped() {
  return loopIn.readSync();
}

// call when pinPlay goes high
function playWatch(err, value) {
  if (err) {
    throw err;
  }

  playTrack(readTrack(), readLooped());
}

// call when pinStop goes high
function stopWatch(err, value) {
  if (err) {
    throw err;
  }

  stopAudio();
}

// pulse pinEnded when audio stops
function audioEnded() {
  console.log('audioEnded()');
  currentData.playAudio = false;

  endedOut.write(0);

  clearTimeout(endedTimeout);
  endedTimeout = setTimeout(() => {
    console.log('audioEnded(): reset');
    endedOut.write(1);
  }, 500);
}

function playTrack(track, looped) {
  if (! currentData.puzzleData.hasOwnProperty('track_mp3')) {
    console.log('playTrack: puzzleData not yet loaded');

    return;
  }


  if (track == TRACK_CORRECT) {
    currentData.audioPath = route('index') + currentData.puzzleData['track_mp3'][track][currentData.correctTrack];

    currentData.correctTrack++;
    if (currentData.correctTrack == currentData.puzzleData['track_mp3'][TRACK_CORRECT].length) {
      currentData.correctTrack = 0;
    }
  } else if (track == TRACK_INCORRECT) {
    currentData.audioPath = route('index') + currentData.puzzleData['track_mp3'][track][currentData.incorrectTrack];

    currentData.incorrectTrack++;
    if (currentData.incorrectTrack == currentData.puzzleData['track_mp3'][TRACK_INCORRECT].length) {
      currentData.incorrectTrack = 0;
    }
  } else {
    currentData.audioPath = route('index') + currentData.puzzleData['track_mp3'][track];
  }
  currentData.playLooped = looped;
  currentData.playAudio = true;

  playAudioLoop();
}

function playAudioLoop() {
  console.log('playAudioLoop()');

  if (currentData.playAudio == false) {
    return;
  }

  try {
    audio.kill();
  } catch (error) {
    //
  }


  let volume =  defaultVolume;
  log('Playing (' + (currentData.playLooped ? 'looped' : 'once') + ') : ' + currentData.audioPath + ' at volume: ' + volume);
  currentData.playingPath = currentData.audioPath;

  endedOut.write(1);
  audio = player.play(
    currentData.playingPath,
    { mpg123: ['-g', volume] },
    function(err) {
      log('Playing ended: ' + currentData.playingPath);
      if (err && !err.killed) {
        log("Play Error:", err);
      } else if (err && err.killed) {
        // we stopped the audio
        log("Play Stopped");
      } else {
        if (currentData.playAudio == false) {
          console.log("currentData.playAudio == false")

          return;
        }
        if (currentData.playLooped) {
          playAudioLoop();
        } else {
          audioEnded();
        }
      }
    }
  );
}

function stopAudio() {
  console.log('stopAudio())');
  currentData.playAudio = false;
  try {
    audio.kill();
  } catch (error) {
    //
  }
}

function log(...args) {
  console.log(...args);
  if (mqttClient.connected) {
    mqttClient.publish(puzzleLogTopic, JSON.stringify(args));
  }
}

endedOut.write(0);
