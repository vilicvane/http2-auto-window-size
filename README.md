[![NPM version](https://img.shields.io/npm/v/http2-auto-window-size?color=%23cb3837&style=flat-square)](https://www.npmjs.com/package/http2-auto-window-size)
[![Repository package.json version](https://img.shields.io/github/package-json/v/vilicvane/http2-auto-window-size?color=%230969da&label=repo&style=flat-square)](./package.json)
[![MIT License](https://img.shields.io/badge/license-MIT-999999?style=flat-square)](./LICENSE)
[![Discord](https://img.shields.io/badge/chat-discord-5662f6?style=flat-square)](https://discord.gg/wEVn2qcf8h)

# http2-auto-window-size

Set HTTP/2 window size automatically based on estimated bandwidth and ping duration (RTT).

## Strategy

1. tolerable latency -> increase window size if bandwidth is high.
2. intolerable latency -> reduce window size if bandwidth is low.

## Installation

```sh
npm install http2-auto-window-size
```

## Usage

```js
import {setupAutoWindowSize} from 'http2-auto-window-size';

server.on('session', session => setupAutoWindowSize(session));
```

## License

MIT License.
