# Ho Ho Hurry Up Snowmen Audio

## Notes
```
sudo apt-get update
sudo apt-get install build-essential software-properties-common vim git curl apt-transport-https lsb-release ca-certificates dirmngr unzip
sudo apt-get install avahi-daemon avahi-discover avahi-utils libnss-mdns

# https://github.com/nodesource/distributions#debian-and-ubuntu-based-distributions

sudo npm install typescript rimraf node-gyp -g
sudo npm install ts-node -g
sudo apt-get -y install mpg321
```

was IQAduIO is now owned by foundation  
https://www.raspberrypi.com/documentation/accessories/audio.html
https://pinout.xyz/pinout/pi_digiamp  

`dtoverlay=iqaudio-digiampplus,unmute_amp`
`#dtparam=audio=on`


## used pins

2   i2c
3   i2c
18  i2s
22  mute/unmute
23  ? rotray
24  ? rotray
25  ? IR Sendor
19  i2s
20  i2s
21  i2s

5   Play    <   # Default: Up       Needed: Down
6   Loop    <   # Default: Up       Needed: Down
12  Stop    <   # Default: Down     Needed: Down
13  Ended   >   # Default: Down     Needed: Up
8   Track Bit 0     <   # Default: Up       Needed: Down
9   Track Bit 1     <   # Default: Down     Needed: Down
10  Track Bit 2     <   # Default: Down     Needed: Down
11  Track Bit 3     <   # Default: Down     Needed: Down

use dtoverlay to config direction and pull
`gpio=5,6,12,8,9,10,11=ip,pd`
`gpio=13=op,dh`


# Puzzle Data
Store Name `ho-ho-hurry-up:hurry-up-snowmen`

| Key               | Type   | Default                                          |
|-------------------|--------|--------------------------------------------------|
| `events`          | json   | {"startIntro":"SNOWMAN_START_INTRO",             | <
|                   |        | "overrideRestart":"SNOWMAN_OVERIDE_RESTART",     | <
|                   |        | "overrideCorrect":"SNOWMAN_OVERIDE_CORRECT",     | <
|                   |        | "correct":"SNOWMAN_CORRECT",                     | >
|                   |        | "incorrect":"SNOWMAN_INCORRECT",                 | >
|                   |        | "solved":"SNOWMAN_SOLVED",                       | >
|                   |        | "dropCarrot":"GOLDEN_CARROT",                    | <
|                   |        | }                                                |
|                   |        |                                                  |
|                   |        |                                                  |
| `timings`         | json   | {                                                |
|                   |        | "buttonDebounceMS": DEFAULT_BUTTON_DEBOUNCE_MS,  |
|                   |        | }                                                |
|                   |        |                                                  |
| `track_answers`   | json   | {                                                |
|                   |        | "1":"PURPLE",                                    |
|                   |        | "2":"GREEN",                                     |
|                   |        | }                                                |
|                   |        |                                                  |
| `track_mp3`       | json   | {                                                |
|                   |        | "0":"/audio/ho-ho-hurry-up/intro.mp3",           |
|                   |        | "1":"/audio/ho-ho-hurry-up/track_1.mp3",         |
|                   |        | "":"",                                           |
|                   |        | }                                                |
|                   |        |                                                  |





```
var player = require('play-sound')(opts = {})

player.play('http://staging-tempus.local/audio/rameseize/anticlock.mp3', { mpg123: ['-g', 10] }, function(err) {
  if (err) throw err
})
```

TODO: use puzzle data for default volume control?
some way to remote restart the process
some way to remote reload the data
internally catch no network at startup and retry nicely

# Logic

Audio stops at all game state changes.
