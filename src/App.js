/*
* Copyright 2019-2020 Membrane Software <author@membranesoftware.com> https://membranesoftware.com
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

exports.VERSION = "7-stable-b2fcd336";
exports.AGENT_PLATFORM = "";

exports.BASE_DIRECTORY = process.cwd ();
exports.SOURCE_DIRECTORY = Path.join (exports.BASE_DIRECTORY, "src");
exports.DATA_DIRECTORY = Path.join (exports.BASE_DIRECTORY, "run");
exports.BIN_DIRECTORY = Path.join (exports.BASE_DIRECTORY, "bin");
exports.CONF_DIRECTORY = Path.join (exports.BASE_DIRECTORY, "conf");
exports.CONFIG_FILE = Path.join (exports.BASE_DIRECTORY, "conf", "systemagent.conf");
exports.WEBROOT_DIRECTORY = Path.join (exports.BASE_DIRECTORY, "www");

exports.AgentDisplayName = null;
exports.AgentApplicationName = "Membrane Server";
exports.AgentEnabled = true;
exports.UrlHostname = null;
exports.TcpPort1 = 63738;
exports.TcpPort2 = 63739;
exports.UdpPort = 63738;
exports.LinkPath = "/";
exports.EnableHttps = true;
exports.AuthorizePath = "auth";
exports.AuthorizeSecret = "";
exports.AuthorizeTokenLength = 64;
exports.AuthorizeSessionDuration = 60000; // milliseconds
exports.MaxTaskCount = 1;
exports.OpensslPath = "";
exports.MongodPath = "/usr/bin/mongod";
exports.StorePort = 27017;
exports.StoreDatabase = "membrane";
exports.StoreCollection = "records";
exports.StoreHost = "127.0.0.1";
exports.StoreUsername = "";
exports.StorePassword = "";
exports.StoreRunPeriod = 60; // seconds
exports.Language = "";

exports.ApplicationNewsUrl = "https://membranesoftware.com/application-news/";
exports.IntentWritePeriod = 300; // seconds
exports.HeartbeatPeriod = 500; // milliseconds
exports.OpensslConfigFilename = "openssl.cnf";
exports.TlsKeyFilename = "tls-key.pem";
exports.TlsCsrFilename = "tls-csr.pem";
exports.TlsCertFilename = "tls-cert.pem";
exports.TlsCaPath = "/etc/ssl/certs/ca-certificates.crt";
exports.Slash = "/";
exports.DoubleSlash = `${exports.Slash}${exports.Slash}`;
exports.StreamCachePath = "stream-cache";
exports.StreamHlsPath = "hls";
exports.StreamDashPath = "dash";
exports.StreamThumbnailPath = "thumbnail";
exports.StreamHlsIndexFilename = "index.m3u8";
exports.StreamDashDescriptionFilename = "vod.mpd";
exports.StreamRecordFilename = "record";
exports.CameraCachePath = "camera-cache";

global.App = exports;
