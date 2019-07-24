/*
* Copyright 2019 Membrane Software <author@membranesoftware.com>
*                 https://membranesoftware.com
*
* Redistribution and use in source and binary forms, with or without
* modification, are permitted provided that the following conditions are met:
*
* 1. Redistributions of source code must retain the above copyright notice,
* this list of conditions and the following disclaimer.
*
* 2. Redistributions in binary form must reproduce the above copyright notice,
* this list of conditions and the following disclaimer in the documentation
* and/or other materials provided with the distribution.
*
* 3. Neither the name of the copyright holder nor the names of its contributors
* may be used to endorse or promote products derived from this software without
* specific prior written permission.
*
* THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
* AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
* IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
* ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
* LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
* CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
* SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
* INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
* CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
* ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
* POSSIBILITY OF SUCH DAMAGE.
*/
// Object that holds global application state

"use strict";

const Path = require ("path");

exports.VERSION = "3-stable-180ae32c";
exports.AGENT_PLATFORM = "";

exports.BASE_DIRECTORY = process.cwd ();
exports.SOURCE_DIRECTORY = Path.join (exports.BASE_DIRECTORY, "src");
exports.DATA_DIRECTORY = Path.join (exports.BASE_DIRECTORY, "run");
exports.BIN_DIRECTORY = Path.join (exports.BASE_DIRECTORY, "bin");
exports.CONF_DIRECTORY = Path.join (exports.BASE_DIRECTORY, "conf");
exports.CONFIG_FILE = Path.join (exports.BASE_DIRECTORY, "conf", "systemagent.conf");
exports.WEBROOT_DIRECTORY = Path.join (exports.BASE_DIRECTORY, "www");

exports.AGENT_DISPLAY_NAME = null;
exports.AGENT_APPLICATION_NAME = "Membrane Server";
exports.AGENT_ENABLED = true;
exports.URL_HOSTNAME = null;
exports.TCP_PORT1 = 63738;
exports.TCP_PORT2 = 63739;
exports.UDP_PORT = 63738;
exports.LINK_PATH = "/";
exports.ENABLE_HTTPS = true;
exports.AUTHORIZE_PATH = "auth";
exports.AUTHORIZE_SECRET = "";
exports.AUTHORIZE_TOKEN_LENGTH = 64;
exports.AUTHORIZE_SESSION_DURATION = 60000; // milliseconds
exports.MAX_TASK_COUNT = 1;
exports.INTENT_WRITE_PERIOD = 300; // seconds
exports.FFMPEG_PATH = "";
exports.OPENSSL_PATH = "";
exports.MONGOD_PATH = "/usr/bin/mongod";
exports.STORE_PORT = 27017;
exports.STORE_DATABASE = "membrane";
exports.STORE_COLLECTION = "records";
exports.STORE_HOST = "127.0.0.1";
exports.STORE_USERNAME = "";
exports.STORE_PASSWORD = "";
exports.STORE_RUN_PERIOD = 60; // seconds
exports.HEARTBEAT_PERIOD = 500; // milliseconds

exports.OPENSSL_CONFIG_FILENAME = "openssl.cnf";
exports.TLS_KEY_FILENAME = "tls-key.pem";
exports.TLS_CSR_FILENAME = "tls-csr.pem";
exports.TLS_CERT_FILENAME = "tls-cert.pem";

exports.STREAM_CACHE_PATH = "stream-cache";
exports.STREAM_HLS_PATH = "hls";
exports.STREAM_DASH_PATH = "dash";
exports.STREAM_THUMBNAIL_PATH = "thumbnail";
exports.STREAM_HLS_INDEX_FILENAME = "index.m3u8";
exports.STREAM_DASH_DESCRIPTION_FILENAME = "vod.mpd";
exports.STREAM_RECORD_FILENAME = "record";

exports.CAMERA_CACHE_PATH = "camera-cache";

global.App = exports;
