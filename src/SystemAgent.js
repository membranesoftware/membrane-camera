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
// Class that runs servers and receives remote commands on their behalf

"use strict";

const App = global.App || { };
const Os = require ("os");
const Fs = require ("fs");
const Path = require ("path");
const Http = require ("http");
const Https = require ("https");
const Crypto = require ("crypto");
const EventEmitter = require ("events").EventEmitter;
const Dgram = require ("dgram");
const Url = require ("url");
const QueryString = require ("querystring");
const UuidV4 = require ("uuid/v4");
const Async = require ("async");
const Io = require ("socket.io");
const Log = require (Path.join (App.SOURCE_DIRECTORY, "Log"));
const FsUtil = require (Path.join (App.SOURCE_DIRECTORY, "FsUtil"));
const StringUtil = require (Path.join (App.SOURCE_DIRECTORY, "StringUtil"));
const Ipv4Address = require (Path.join (App.SOURCE_DIRECTORY, "Ipv4Address"));
const TaskGroup = require (Path.join (App.SOURCE_DIRECTORY, "Task", "TaskGroup"));
const RepeatTask = require (Path.join (App.SOURCE_DIRECTORY, "RepeatTask"));
const IntentGroup = require (Path.join (App.SOURCE_DIRECTORY, "Intent", "IntentGroup"));
const AgentControl = require (Path.join (App.SOURCE_DIRECTORY, "AgentControl"));
const SystemInterface = require (Path.join (App.SOURCE_DIRECTORY, "SystemInterface"));
const DataStore = require (Path.join (App.SOURCE_DIRECTORY, "DataStore"));
const AccessControl = require (Path.join (App.SOURCE_DIRECTORY, "AccessControl"));
const ExecProcess = require (Path.join (App.SOURCE_DIRECTORY, "ExecProcess"));
const Server = require (Path.join (App.SOURCE_DIRECTORY, "Server", "Server"));

const StartEvent = "start";
const AgentStatusEvent = "AgentStatus";
const WebrootIndexFilename = "index.html";

class SystemAgent {
	constructor () {
		this.isEnabled = true;
		this.runStatePath = Path.join (App.DATA_DIRECTORY, "state");
		this.agentId = "";

		this.displayName = "";
		this.applicationName = "";
		this.userAgent = "";
		this.urlHostname = "";
		this.memoryFilePath = "";

		this.isStarted = false;
		this.startTime = 0;
		this.httpServer1 = null;
		this.io = null;
		this.httpServerPort1 = 0;
		this.httpServer2 = null;
		this.httpServerPort2 = 0;

		this.isBroadcastReady = false;
		this.datagramSocket = null;
		this.datagramSocketPort = 0;

		this.linkPath = App.LinkPath;
		if (this.linkPath == "") {
			this.linkPath = this.getRandomString (32);
		}
		if (this.linkPath.indexOf ("/") != 0) {
			this.linkPath = `/${this.linkPath}`;
		}

		this.updateNetworkTask = new RepeatTask ();
		this.shouldResetNetworkServers = false;

		// A map of interface names to network addresses
		this.networkAddressMap = { };

		// A map of interface names to broadcast addresses
		this.broadcastAddressMap = { };

		// A map of paths to functions for handling requests received by the main HTTP server
		this.mainRequestHandlerMap = { };

		// A map of paths to functions for handling requests received by the secondary HTTP server
		this.secondaryRequestHandlerMap = { };

		// A map of URL paths to filesystem paths that should be handled as webroot requests by the main HTTP server
		this.mainWebrootMap = { };

		// A map of URL paths to filesystem paths that should be handled as webroot requests by the secondary HTTP server
		this.secondaryWebrootMap = { };

		this.webrootContentTypeMap = {
			".css": "text/css",
			".jpeg": "image/jpeg",
			".jpg": "image/jpeg",
			".js": "text/javascript",
			".json": "application/json",
			".gif": "image/gif",
			".htm": "text/html",
			".html": "text/html",
			".png": "image/png",
			".ttf": "font/ttf",
			".txt": "text/plain"
		};

		// A map of paths to functions for handling invoke requests received by the main HTTP server
		this.invokeRequestHandlerMap = { };

		// A map of command type values to functions for handling commands received by the link server
		this.linkCommandHandlerMap = { };

		// A list of Server objects
		this.serverList = [ ];

		// A map of configuration values persisted as local state in the agent's data path
		this.runState = { };

		this.accessControl = new AccessControl ();
		this.authorizePath = "";

		this.taskGroup = new TaskGroup ();
		this.taskGroup.maxRunCount = App.MaxTaskCount;

		this.intentGroup = new IntentGroup ();
		this.intentGroup.writePeriod = App.IntentWritePeriod;

		this.agentControl = new AgentControl ();

		this.dataStore = null;
		this.dataStoreRunCount = 0;
		this.runDataStoreTask = new RepeatTask ();
		this.runDataStoreEventEmitter = new EventEmitter ();
		this.runDataStoreEventEmitter.setMaxListeners (0);

		this.agentStatusTask = new RepeatTask ();
		this.agentStatusEventEmitter = new EventEmitter ();
		this.agentStatusEventEmitter.setMaxListeners (0);
		this.lastAgentStatus = null;
	}

	// Start the agent's operation and invoke startCompleteCallback (err) when complete
	start (startCompleteCallback) {
		let pos, server, serverconfigs;

		if (this.isStarted) {
			process.nextTick (startCompleteCallback);
			return;
		}

		this.isEnabled = App.AgentEnabled;
		this.applicationName = App.AgentApplicationName;
		this.userAgent = `${this.applicationName}/${App.VERSION}_${App.AGENT_PLATFORM}`;

		if (App.AgentDisplayName != null) {
			this.displayName = App.AgentDisplayName;
		}
		else {
			this.displayName = Os.hostname ();
			pos = this.displayName.indexOf (".");
			if (pos > 0) {
				this.displayName = this.displayName.substring (0, pos);
			}
		}

		serverconfigs = FsUtil.readConfigFile (Path.join (App.CONF_DIRECTORY, "server.conf"));
		if (serverconfigs == null) {
			serverconfigs = [ ];
		}
		if (serverconfigs.length <= 0) {
			Log.notice ("No server types configured, remote functionality may be limited");
		}

		for (const config of serverconfigs) {
			if (Server.ServerTypes[config.type] == null) {
				process.nextTick (() => {
					startCompleteCallback (`Unknown server type "${config.type}"`);
				});
				return;
			}

			server = new Server.ServerTypes[config.type] ();
			server.baseConfiguration = config.params;
			this.serverList.push (server);
		}

		this.startTime = Date.now ();

		FsUtil.createDirectory (App.DATA_DIRECTORY).then (() => {
			return (FsUtil.readStateFile (this.runStatePath));
		}).then ((state) => {
			if (state == null) {
				this.agentId = UuidV4 ();
				Log.debug (`Assign agent ID; id=${this.agentId}`);
				this.runState.agentId = this.agentId;
				return (FsUtil.writeStateFile (this.runStatePath, this.runState));
			}
			this.runState = state;

			if (typeof this.runState.agentId != "string") {
				this.agentId = UuidV4 ();
				Log.debug (`Assign agent ID; id=${this.agentId}`);
				this.runState.agentId = this.agentId;
				return (FsUtil.writeStateFile (this.runStatePath, this.runState));
			}

			this.agentId = this.runState.agentId;
			if (this.runState.agentConfiguration != null) {
				if (typeof this.runState.agentConfiguration.isEnabled == "boolean") {
					this.isEnabled = this.runState.agentConfiguration.isEnabled;
				}
				if ((typeof this.runState.agentConfiguration.displayName == "string") && (this.runState.agentConfiguration.displayName != "")) {
					this.displayName = this.runState.agentConfiguration.displayName;
				}
			}
		}).then (() => {
			return (this.generateTlsConfig ());
		}).then (() => {
			if (this.isEnabled) {
				return (this.startAllServers ());
			}
		}).then (() => {
			let digest, len;

			if ((typeof this.runState.adminSecret == "string") && (this.runState.adminSecret != "")) {
				digest = this.runState.adminSecret;
				len = digest.length / 2;
				if (len <= 0) {
					App.AuthorizeSecret = digest;
					this.setAuthInvokeRequestHandler (SystemInterface.Constant.DefaultAuthorizePath);
				}
				else {
					App.AuthorizeSecret = digest.substring (0, len);
					this.setAuthInvokeRequestHandler (digest.substring (len));
				}
			}
			else {
				this.setAuthInvokeRequestHandler (App.AuthorizePath);
			}

			this.accessControl.start ();
			this.taskGroup.start ();
			this.intentGroup.start ();
		}).then (() => {
			if (this.dataStoreRunCount > 0) {
				this.dataStore = new DataStore (App.MongodPath, Path.join (App.DATA_DIRECTORY, "records"), App.StorePort);
				return (this.dataStore.run ());
			}
		}).then (() => {
			return (this.openMemoryFilePath ());
		}).then (() => {
			this.addInvokeRequestHandler (SystemInterface.Constant.DefaultInvokePath, SystemInterface.Constant.DefaultCommandType, (cmdInv, request, response) => {
				switch (cmdInv.command) {
					case SystemInterface.CommandId.GetStatus: {
						this.writeCommandResponse (request, response, this.getStatus ());
						break;
					}
					case SystemInterface.CommandId.GetAgentConfiguration: {
						this.writeCommandResponse (request, response, this.getConfiguration ());
						break;
					}
					case SystemInterface.CommandId.UpdateAgentConfiguration: {
						this.updateAgentConfiguration (cmdInv, request, response);
						break;
					}
					case SystemInterface.CommandId.ShutdownAgent: {
						this.shutdownAgent (cmdInv, request, response);
						break;
					}
					case SystemInterface.CommandId.SetAdminSecret: {
						this.setAdminSecret (cmdInv, request, response);
						break;
					}
					case SystemInterface.CommandId.CancelTask: {
						this.taskGroup.cancelTask (cmdInv);
						this.writeCommandResponse (request, response, this.createCommand ("CommandResult", SystemInterface.Constant.DefaultCommandType, {
							success: true
						}));
						break;
					}
					default: {
						this.writeResponse (request, response, 400);
						break;
					}
				}
			});

			this.addLinkCommandHandler (SystemInterface.Constant.Admin, (cmdInv, client) => {
				switch (cmdInv.command) {
					case SystemInterface.CommandId.ReadTasks: {
						this.taskGroup.readTasks (cmdInv, client);
						break;
					}
					case SystemInterface.CommandId.WatchTasks: {
						this.taskGroup.watchTasks (cmdInv, client);
						break;
					}
					case SystemInterface.CommandId.WatchStatus: {
						const execute = (agentStatus) => {
							client.emit (SystemInterface.Constant.WebSocketEvent, agentStatus);
						};

						this.agentStatusEventEmitter.addListener (AgentStatusEvent, execute);
						client.once ("disconnect", () => {
							this.agentStatusEventEmitter.removeListener (AgentStatusEvent, execute);
							if (this.agentStatusEventEmitter.listenerCount (AgentStatusEvent) <= 0) {
								this.agentStatusTask.stop ();
							}
						});

						if (! this.agentStatusTask.isRepeating) {
							this.lastAgentStatus = null;
							this.agentStatusTask.setRepeating ((callback) => {
								this.emitAgentStatus (callback);
							}, App.HeartbeatPeriod * 5, App.HeartbeatPeriod * 6);
						}
						break;
					}
				}
			});

			this.updateNetworkTask.setRepeating ((callback) => {
				this.updateNetwork (callback);
			}, App.HeartbeatPeriod * 8, App.HeartbeatPeriod * 16);

			if (this.dataStoreRunCount > 0) {
				this.runDataStoreEventEmitter.emit (StartEvent);
				this.runDataStoreTask.setRepeating ((callback) => {
					this.runDataStoreProcess (callback);
				}, App.StoreRunPeriod * 1000, App.StoreRunPeriod * 1000);
			}

			this.agentControl.start ();

			this.isStarted = true;
			startCompleteCallback ();
		}).catch ((err) => {
			this.accessControl.stop ();
			this.taskGroup.stop ();
			this.intentGroup.stop ();
			this.agentControl.stop ();
			startCompleteCallback (err);
		});
	}

	// Return a promise that generates TLS configuration files if needed
	generateTlsConfig () {
		return (new Promise ((resolve, reject) => {
			let filenames, argslist;

			setTimeout (() => {
				filenames = [
					Path.join (App.DATA_DIRECTORY, App.TlsKeyFilename),
					Path.join (App.DATA_DIRECTORY, App.TlsCertFilename)
				];
				FsUtil.statFiles (filenames, (filename, stats) => {
					return (stats.isFile () && (stats.size > 0));
				}, statFilesComplete);
			}, 0);

			const statFilesComplete = (err) => {
				if (err == null) {
					resolve ();
					return;
				}

				argslist = [
					[
						"genrsa",
						"-out", Path.join (App.DATA_DIRECTORY, App.TlsKeyFilename),
						"2048"
					],
					[
						"req",
						"-config", Path.join (App.BIN_DIRECTORY, App.OpensslConfigFilename),
						"-batch",
						"-new",
						"-sha256",
						"-key", Path.join (App.DATA_DIRECTORY, App.TlsKeyFilename),
						"-out", Path.join (App.DATA_DIRECTORY, App.TlsCsrFilename)
					],
					[
						"x509",
						"-req",
						"-days", "9125",
						"-in", Path.join (App.DATA_DIRECTORY, App.TlsCsrFilename),
						"-signkey", Path.join (App.DATA_DIRECTORY, App.TlsKeyFilename),
						"-out", Path.join (App.DATA_DIRECTORY, App.TlsCertFilename)
					]
				];
				Async.eachSeries (argslist, execOpenssl, execComplete);
			};
			const execOpenssl = (args, callback) => {
				App.systemAgent.createOpensslProcess (args, App.DATA_DIRECTORY, null, (err, isExitSuccess) => {
					if (err != null) {
						callback (`Failed to generate TLS configuration; err=${err}`);
						return;
					}
					if (! isExitSuccess) {
						callback ("Failed to generate TLS configuration; err=openssl process ended with error");
						return;
					}

					callback ();
				});
			};
			const execComplete = (err) => {
				if (err != null) {
					reject (Error (err));
					return;
				}

				resolve ();
			};
		}));
	}

	// Execute a request to check for application news from membranesoftware.com
	getApplicationNews () {
		const url = `${App.ApplicationNewsUrl}${App.VERSION}_${App.AGENT_PLATFORM}_${(App.Language != "") ? App.Language : "en"}`;
		this.fetchUrlData (url).then ((urlData) => {
			let msg;

			const cmdinv = SystemInterface.parseCommand (urlData);
			if (SystemInterface.isError (cmdinv) || (cmdinv.command != SystemInterface.CommandId.ApplicationNews)) {
				throw Error ("Received non-parsing response data");
			}
			for (const item of cmdinv.params.items) {
				if ((typeof item.actionTarget == "string") && item.actionTarget.match (/http.*\/update[^0-9a-zA-Z]/)) {
					msg = `${item.message} `;
					if (typeof item.actionText == "string") {
						msg += `${item.actionText}: `;
					}
					msg += item.actionTarget;
					Log.notice (msg);
				}
			}
		}).catch ((err) => {
			Log.warn (`Failed to check for application updates; err=${err}`);
		});
	}

	// Return a promise that starts the main HTTP server if it isn't already running
	startMainHttpServer () {
		return (new Promise ((resolve, reject) => {
			let http, options;

			if (this.httpServer1 != null) {
				resolve ();
				return;
			}

			options = { };
			if (App.EnableHttps) {
				try {
					options = {
						key: Fs.readFileSync (Path.join (App.DATA_DIRECTORY, App.TlsKeyFilename)),
						cert: Fs.readFileSync (Path.join (App.DATA_DIRECTORY, App.TlsCertFilename))
					};
				}
				catch (e) {
					reject (Error (e));
					return;
				}
			}

			if (App.EnableHttps) {
				http = Https.createServer (options, (request, response) => {
					this.handleMainServerRequest (request, response);
				});
			}
			else {
				http = Http.createServer ((request, response) => {
					this.handleMainServerRequest (request, response);
				});
			}
			this.httpServer1 = http;

			setTimeout (() => {
				http.on ("error", listenError);
				http.listen (App.TcpPort1, null, 1024, listenComplete);
			}, 0);

			const listenError = (err) => {
				http.removeListener ("error", listenError);
				reject (Error (err));
			};

			const runError = (err) => {
				Log.err (`HTTP-1 error; err=${err}`);
			};

			const listenComplete = () => {
				http.removeListener ("error", listenError);
				const address = http.address ();
				if (typeof address.port != "number") {
					reject (Error ("Internal error: failed to read listen port from HTTP server"));
					return;
				}

				this.httpServerPort1 = address.port;
				this.resetUrlHostname ();
				Log.debug (`HTTP-1 listening; address=${this.urlHostname}:${this.httpServerPort1}`);
				if (this.httpServerPort1 == SystemInterface.Constant.DefaultTcpPort1) {
					Log.info (`Server address: ${this.urlHostname}`);
				}
				else {
					Log.info (`Server address: ${this.urlHostname}:${this.httpServerPort1}`);
				}

				const io = Io.listen (http, { "path": this.linkPath });
				io.on ("connection", ioConnection);
				this.io = io;

				http.on ("error", runError);
				http.once ("close", () => {
					http.removeListener ("error", runError);
					if (this.httpServer1 == http) {
						this.httpServer1 = null;
					}
				});

				resolve ();
			};

			const ioConnection = (client) => {
				let token;

				const clientaddress = client.request.connection.remoteAddress;
				token = "";
				Log.debug (`WebSocket client connected; address="${clientaddress}"`);

				client.setMaxListeners (0);
				client.once ("disconnect", () => {
					Log.debug (`WebSocket client disconnected; address="${clientaddress}"`);
					if (token != "") {
						this.accessControl.setSessionSustained (token, false);
						token = "";
					}
				});

				client.on (SystemInterface.Constant.WebSocketEvent, (cmdInv) => {
					const err = SystemInterface.parseCommand (cmdInv);
					if (SystemInterface.isError (err)) {
						Log.debug (`Discard WebSocket command; address=${clientaddress} cmdInv=${JSON.stringify (cmdInv)} err=${err}`);
						return;
					}

					if ((App.AuthorizeSecret != "") && (cmdInv.command == SystemInterface.CommandId.Authorize)) {
						const respcmd = this.accessControl.authorize (cmdInv);
						if (respcmd.command == SystemInterface.CommandId.AuthorizeResult) {
							if (token != "") {
								this.accessControl.setSessionSustained (token, false);
							}
							token = respcmd.params.token;
							this.accessControl.setSessionSustained (token, true);
							client.emit (SystemInterface.Constant.WebSocketEvent, respcmd);
							client.emit (SystemInterface.Constant.WebSocketEvent, this.createCommand ("LinkSuccess", SystemInterface.Constant.DefaultCommandType));
						}
						else {
							client.emit (SystemInterface.Constant.WebSocketEvent, this.createCommand ("AuthorizationRequired", SystemInterface.Constant.DefaultCommandType));
						}
						return;
					}

					const fn = this.linkCommandHandlerMap[cmdInv.commandType];
					if (typeof fn == "function") {
						if (App.AuthorizeSecret != "") {
							if (! this.accessControl.isCommandAuthorized (cmdInv)) {
								Log.debug (`Discard WebSocket command (unauthorized); address=${clientaddress}`);
								return;
							}
						}

						fn (cmdInv, client);
					}
				});

				if (App.AuthorizeSecret != "") {
					client.emit (SystemInterface.Constant.WebSocketEvent, this.createCommand ("AuthorizationRequired", SystemInterface.Constant.DefaultCommandType));
				}
				else {
					client.emit (SystemInterface.Constant.WebSocketEvent, this.createCommand ("LinkSuccess", SystemInterface.Constant.DefaultCommandType));
				}
			};
		}));
	}

	// Return a promise that closes the main HTTP server
	closeMainHttpServer () {
		return (new Promise ((resolve, reject) => {
			const http = this.httpServer1;
			if (http == null) {
				resolve ();
				return;
			}

			http.close ((err) => {
				if (err) {
					Log.debug (`HTTP-1 close error; err=${err}`);
				}
				if (http == this.httpServer1) {
					this.httpServer1 = null;
				}
				resolve ();
			});
			if (this.io != null) {
				try {
					this.io.close ();
				}
				catch (err) {
					Log.debug (`IO close error; err=${err}`);
				}
				this.io = null;
			}
		}));
	}

	// Return a promise that starts the secondary HTTP server if it isn't already running
	startSecondaryHttpServer () {
		return (new Promise ((resolve, reject) => {
			if (this.httpServer2 != null) {
				resolve ();
				return;
			}
			const http = Http.createServer ((request, response) => {
				this.handleSecondaryServerRequest (request, response);
			});
			this.httpServer2 = http;

			setTimeout (() => {
				http.on ("error", listenError);
				http.listen (App.TcpPort2, null, 1024, listenComplete);
			}, 0);

			const listenError = (err) => {
				http.removeListener ("error", listenError);
				reject (Error (err));
			};

			const runError = (err) => {
				Log.err (`HTTP-2 error; err=${err}`);
			};

			const listenComplete = () => {
				http.removeListener ("error", listenError);
				const address = http.address ();
				if (typeof address.port != "number") {
					reject (Error ("Internal error: failed to read listen port from HTTP server"));
					return;
				}

				this.httpServerPort2 = address.port;
				Log.debug (`HTTP-2 listening; address=${this.urlHostname}:${this.httpServerPort2}`);
				http.on ("error", runError);
				http.once ("close", () => {
					http.removeListener ("error", runError);
					if (this.httpServer2 == http) {
						this.httpServer2 = null;
					}
				});

				resolve ();
			};
		}));
	}

	// Return a promise that closes the secondary HTTP server
	closeSecondaryHttpServer () {
		return (new Promise ((resolve, reject) => {
			const http = this.httpServer2;
			if (http == null) {
				resolve ();
				return;
			}

			http.close ((err) => {
				if (err) {
					Log.debug (`HTTP-2 close error; err=${err}`);
				}
				if (http == this.httpServer2) {
					this.httpServer2 = null;
				}
				resolve ();
			});
		}));
	}

	// Return a promise that starts the datagram socket if it isn't already running
	startDatagramSocket () {
		return (new Promise ((resolve, reject) => {
			if (this.datagramSocket != null) {
				resolve ();
				return;
			}

			this.isBroadcastReady = false;
			const socket = Dgram.createSocket ("udp4");

			const listenError = (err) => {
				socket.removeListener ("error", listenError);
				reject (Error (err));
			};

			const runError = (err) => {
				Log.err (`Datagram socket error; err=${err}`);
			};

			socket.on ("error", listenError);
			socket.once ("listening", () => {
				let port;

				socket.removeListener ("error", listenError);
				try {
					socket.setBroadcast (true);
				}
				catch (err) {
					reject (Error (err));
					return;
				}
				const address = socket.address ();
				if (address != null) {
					port = address.port;
				}
				if (typeof port != "number") {
					reject (Error ("Failed to read port from datagram socket"));
					return;
				}
				Log.debug (`Datagram socket listening; port=${port}`);

				socket.on ("error", runError);
				socket.once ("close", () => {
					socket.removeListener ("error", runError);
					if (this.datagramSocket == socket) {
						this.datagramSocket = null;
					}
				});

				socket.on ("message", (msg, rinfo) => {
					this.handleDatagramMessage (msg);
				});

				this.datagramSocket = socket;
				this.datagramSocketPort = port;
				this.isBroadcastReady = true;
				resolve ();
			});

			socket.bind (App.UdpPort);
		}));
	}

	// Return a promise that closes the datagram socket
	closeDatagramSocket () {
		return (new Promise ((resolve, reject) => {
			const socket = this.datagramSocket;
			if (socket == null) {
				resolve ();
				return;
			}

			socket.close ((err) => {
				if (err) {
					reject (Error (err));
					return;
				}
				if (socket == this.datagramSocket) {
					this.datagramSocket = null;
					this.isBroadcastReady = false;
				}
				resolve ();
			});
		}));
	}

	// Start all servers and invoke startCompleteCallback (err) when complete. If startCompleteCallback is not provided, instead return a promise that executes the operation.
	startAllServers (startCompleteCallback) {
		const execute = (executeCallback) => {
			let state;

			if (! this.isEnabled) {
				process.nextTick (() => {
					executeCallback ("Agent is not enabled for operation");
				});
				return;
			}

			for (const server of this.serverList) {
				if (server.isRunning) {
					process.nextTick (() => {
						executeCallback (`${server.name} is already running`);
					});
					return;
				}
			}

			state = { };
			if ((typeof this.runState.agentConfiguration == "object") && (this.runState.agentConfiguration != null)) {
				state = SystemInterface.parseTypeObject ("AgentConfiguration", this.runState.agentConfiguration);
				if (SystemInterface.isError (state)) {
					Log.err (`Failed to parse stored server configuration; err=${state}`);
					state = { };
				}
			}
			for (const server of this.serverList) {
				server.configure (state[server.getAgentConfigurationKey ()]);
				if (! server.isConfigured) {
					process.nextTick (() => {
						executeCallback (`${server.name} is not configured`);
					});
					return;
				}
			}

			const startServer = (item, callback) => {
				item.start ((err) => {
					if (err != null) {
						Log.err (`Failed to start server; name=${item.name} err=${err.stack}`);
					}
					callback (err);
				});
			};
			Async.eachSeries (this.serverList, startServer, executeCallback);
		};

		if (typeof startCompleteCallback == "function") {
			execute (startCompleteCallback);
		}
		else {
			return (new Promise ((resolve, reject) => {
				execute ((err) => {
					if (err != null) {
						reject (Error (err));
						return;
					}
					resolve ();
				});
			}));
		}
	}

	// Stop the agent's operation and invoke stopCallback when complete
	stop (stopCallback) {
		this.updateNetworkTask.stop ();
		this.runDataStoreTask.stop ();
		this.agentStatusTask.stop ();
		this.accessControl.stop ();
		this.taskGroup.stop ();
		this.intentGroup.stop ();
		this.agentControl.stop ();

		this.closeDatagramSocket ().then (() => {
			return (this.closeMainHttpServer ());
		}).then (() => {
			return (this.closeSecondaryHttpServer ());
		}).then (() => {
			return (this.stopAllServers ());
		}).then (() => {
			if (this.isStarted) {
				return (this.intentGroup.writeState ());
			}
		}).catch ((err) => {
			Log.debug (`Error stopping servers; err=${err}`);
		}).then (() => {
			stopCallback ();
		});
	}

	// Stop all servers and invoke endCallback when complete. If endCallback is not provided, instead return a promise that executes the operation.
	stopAllServers (endCallback) {
		const execute = (executeCallback) => {
			let serverindex;

			const stopNextServer = () => {
				if (serverindex >= this.serverList.length) {
					executeCallback ();
					return;
				}

				this.serverList[serverindex].stop (stopComplete);
			};

			const stopComplete = () => {
				++serverindex;
				stopNextServer ();
			};

			serverindex = 0;
			stopNextServer ();
		};

		if (typeof endCallback == "function") {
			execute (endCallback);
		}
		else {
			return (new Promise ((resolve, reject) => {
				execute ((err) => {
					if (err != null) {
						reject (Error (err));
						return;
					}
					resolve ();
				});
			}));
		}
	}

	// Execute a received UpdateAgentConfiguration command
	updateAgentConfiguration (cmdInv, request, response) {
		let err, conf;

		err = false;
		for (const server of this.serverList) {
			conf = cmdInv.params.agentConfiguration[server.getAgentConfigurationKey ()];
			if ((typeof conf == "object") && (conf != null)) {
				if (! server.isConfigurationValid (conf)) {
					err = true;
					break;
				}
			}
		}
		if (err) {
			this.writeCommandResponse (request, response, this.createCommand ("CommandResult", SystemInterface.Constant.DefaultCommandType, {
				success: false,
				error: "Invalid configuration parameters"
			}));
			return;
		}

		if ((typeof this.runState.agentConfiguration != "object") || (this.runState.agentConfiguration == null)) {
			this.runState.agentConfiguration = { };
		}
		for (const server of this.serverList) {
			conf = cmdInv.params.agentConfiguration[server.getAgentConfigurationKey ()];
			if ((typeof conf == "object") && (conf != null)) {
				server.configure (conf);
				this.runState.agentConfiguration[server.getAgentConfigurationKey ()] = conf;
			}
		}

		this.displayName = cmdInv.params.agentConfiguration.displayName;
		this.runState.agentConfiguration.displayName = this.displayName;

		if ((typeof cmdInv.params.agentConfiguration.isEnabled == "boolean") && (cmdInv.params.agentConfiguration.isEnabled != this.isEnabled)) {
			this.isEnabled = cmdInv.params.agentConfiguration.isEnabled;
			this.runState.agentConfiguration.isEnabled = this.isEnabled;

			if (this.isEnabled) {
				this.startAllServers (() => { });
			}
			else {
				this.stopAllServers (() => { });
			}
		}

		FsUtil.writeStateFile (this.runStatePath, this.runState, (err) => {
			if (err != null) {
				Log.err (`Failed to write run state; path=${this.runStatePath} err=${err}`);
			}
		});
		this.writeCommandResponse (request, response, this.getConfiguration ());
	}

	// Execute a received ShutdownAgent command
	shutdownAgent (cmdInv, request, response) {
		Log.notice ("Shutdown application by remote command");

		this.stopAllServers (() => {
			process.exit (0);
		});
		this.writeCommandResponse (request, response, this.createCommand ("CommandResult", SystemInterface.Constant.DefaultCommandType, {
			success: true
		}));
	}

	// Execute a received SetAdminSecret command
	setAdminSecret (cmdInv, request, response) {
		let hash, digest, len;

		if (cmdInv.params.secret == "") {
			Log.info ("Clear admin secret by remote command");
			this.setAuthInvokeRequestHandler (App.AuthorizePath);
			App.AuthorizeSecret = "";
			this.updateRunState ({ adminSecret: "" });
		}
		else {
			Log.info ("Reset admin secret by remote command");
			hash = Crypto.createHash (SystemInterface.Constant.AuthorizationHashAlgorithm);
			hash.update (cmdInv.params.secret);
			digest = hash.digest ("hex");
			len = digest.length / 2;
			if (len <= 0) {
				App.AuthorizeSecret = digest;
				this.setAuthInvokeRequestHandler (SystemInterface.Constant.DefaultAuthorizePath);
			}
			else {
				App.AuthorizeSecret = digest.substring (0, len);
				this.setAuthInvokeRequestHandler (digest.substring (len));
			}
			this.updateRunState ({ adminSecret: digest });
		}
		this.writeCommandResponse (request, response, this.createCommand ("CommandResult", SystemInterface.Constant.DefaultCommandType, {
			success: true
		}));
	}

	// Reset the urlHostname value as appropriate for configured values and detected interfaces
	resetUrlHostname () {
		let urlhostname;

		if (App.UrlHostname != null) {
			this.urlHostname = App.UrlHostname;
			return;
		}

		urlhostname = "";
		const interfaces = Os.networkInterfaces ();
		for (const i in interfaces) {
			const addresses = interfaces[i];
			for (const addr of addresses) {
				if (addr.internal) {
					continue;
				}
				if (addr.family != "IPv4") {
					// TODO: Possibly support IPv6 interface addresses
					continue;
				}

				const ip = new Ipv4Address (addr.address);
				if (ip.isValid) {
					urlhostname = addr.address;
					break;
				}
			}

			if (urlhostname != "") {
				break;
			}
		}

		if (urlhostname != "") {
			this.urlHostname = urlhostname;
		}
		else {
			this.urlHostname = "127.0.0.1";
		}
	}

	// Return the server object with the specified name, or null if no such server was found
	getServer (serverName) {
		for (const server of this.serverList) {
			if (server.name == serverName) {
				return (server);
			}
		}

		return (null);
	}

	// Add a task to the agent's run queue, assigning its ID value in the process. If endCallback is provided, set the task to invoke that function when it completes.
	runTask (task, endCallback) {
		this.taskGroup.runTask (task, endCallback);
	}

	// Add an intent to the agent's intent group, applying an optional group name value for identification
	runIntent (intent, groupName) {
		if (typeof groupName == "string") {
			intent.groupName = groupName;
		}
		this.intentGroup.runIntent (intent);
	}

	// Return an array containing all intent items matching the specified group name and optional active state
	findIntents (groupName, isActive) {
		return (this.intentGroup.findIntents (groupName, isActive));
	}

	// Halt and remove all intents matching the specified group name
	removeIntentGroup (groupName) {
		this.intentGroup.removeIntentGroup (groupName);
	}

	// Handle a request received by the main HTTP server
	handleMainServerRequest (request, response) {
		let path, body;

		path = null;
		const url = Url.parse (request.url);
		if (url != null) {
			path = url.pathname;
		}

		if (path == null) {
			this.writeResponse (request, response, 404);
			return;
		}

		const execute = (body) => {
			let cmdinv, fn, webrootname, filepath, contenttype;

			fn = this.mainRequestHandlerMap[path];
			if (fn != null) {
				cmdinv = SystemInterface.parseCommand (body);
				if (SystemInterface.isError (cmdinv)) {
					cmdinv = { };
				}
				fn (cmdinv, request, response);
				return;
			}

			webrootname = path;
			const matches = webrootname.match (/^([/][^/]*)[/].*$/);
			if (matches != null) {
				webrootname = matches[1];
			}
			const dirname = this.mainWebrootMap[webrootname];
			if (typeof dirname == "string") {
				filepath = Path.join (App.WEBROOT_DIRECTORY, dirname);
				if (path.length >= webrootname.length) {
					filepath = Path.join (filepath, Path.normalize (path.substring (webrootname.length)));
				}
				Fs.stat (filepath, (err, stats) => {
					if (err != null) {
						this.writeResponse (request, response, 404);
						return;
					}
					if (stats.isFile ()) {
						contenttype = this.webrootContentTypeMap[Path.extname (filepath)];
						this.writeFileResponse (request, response, filepath, (typeof contenttype == "string") ? contenttype : "application/octet-stream");
						return;
					}
					if (! stats.isDirectory ()) {
						this.writeResponse (request, response, 404);
						return;
					}

					filepath = Path.normalize (Path.join (filepath, WebrootIndexFilename));
					Fs.stat (filepath, (err, stats) => {
						if (err != null) {
							this.writeResponse (request, response, 404);
							return;
						}
						if (! stats.isFile ()) {
							this.writeResponse (request, response, 404);
							return;
						}

						contenttype = this.webrootContentTypeMap[Path.extname (filepath)];
						this.writeFileResponse (request, response, filepath, (typeof contenttype == "string") ? contenttype : "application/octet-stream");
					});
				});
				return;
			}

			cmdinv = SystemInterface.parseCommand (body);
			if (SystemInterface.isError (cmdinv)) {
				this.writeResponse (request, response, 400);
				return;
			}

			fn = this.invokeRequestHandlerMap[`${cmdinv.commandType}:${path}`];
			if (fn != null) {
				if ((App.AuthorizeSecret != "") && (cmdinv.command != SystemInterface.CommandId.Authorize)) {
					if (! this.accessControl.isCommandAuthorized (cmdinv)) {
						this.writeResponse (request, response, 401);
						return;
					}
				}

				fn (cmdinv, request, response);
				return;
			}

			this.writeResponse (request, response, 404);
		};

		if (request.method == "GET") {
			const q = QueryString.parse (url.query);
			if (typeof q[SystemInterface.Constant.UrlQueryParameter] == "string") {
				execute (q[SystemInterface.Constant.UrlQueryParameter]);
			}
			else {
				execute (q);
			}
		}
		else if (request.method == "POST") {
			body = [ ];
			request.on ("data", (chunk) => {
				body.push (chunk);
			});
			request.on ("end", () => {
				body = Buffer.concat (body).toString ();
				execute (body);
			});
		}
		else {
			this.writeResponse (request, response, 405);
		}
	}

	// Handle a request received by the secondary HTTP server
	handleSecondaryServerRequest (request, response) {
		let path, body;

		path = null;
		const url = Url.parse (request.url);
		if (url != null) {
			path = url.pathname;
		}

		if (path == null) {
			this.writeResponse (request, response, 404);
			return;
		}

		const execute = (body) => {
			let cmdinv, webrootname, filepath, contenttype;

			const fn = this.secondaryRequestHandlerMap[path];
			if (fn != null) {
				cmdinv = SystemInterface.parseCommand (body);
				if (SystemInterface.isError (cmdinv)) {
					cmdinv = { };
				}
				fn (cmdinv, request, response);
				return;
			}

			webrootname = path;
			const matches = webrootname.match (/^([/][^/]*)[/].*$/);
			if (matches != null) {
				webrootname = matches[1];
			}
			const dirname = this.secondaryWebrootMap[webrootname];
			if (typeof dirname != "string") {
				this.writeResponse (request, response, 404);
				return;
			}
			filepath = Path.join (App.WEBROOT_DIRECTORY, dirname);
			if (path.length >= webrootname.length) {
				filepath = Path.join (filepath, Path.normalize (path.substring (webrootname.length)));
			}
			Fs.stat (filepath, (err, stats) => {
				if (err != null) {
					this.writeResponse (request, response, 404);
					return;
				}
				if (stats.isFile ()) {
					contenttype = this.webrootContentTypeMap[Path.extname (filepath)];
					this.writeFileResponse (request, response, filepath, (typeof contenttype == "string") ? contenttype : "application/octet-stream");
					return;
				}
				if (! stats.isDirectory ()) {
					this.writeResponse (request, response, 404);
					return;
				}

				filepath = Path.normalize (Path.join (filepath, WebrootIndexFilename));
				Fs.stat (filepath, (err, stats) => {
					if (err != null) {
						this.writeResponse (request, response, 404);
						return;
					}
					if (! stats.isFile ()) {
						this.writeResponse (request, response, 404);
						return;
					}

					contenttype = this.webrootContentTypeMap[Path.extname (filepath)];
					this.writeFileResponse (request, response, filepath, (typeof contenttype == "string") ? contenttype : "application/octet-stream");
				});
			});
		};

		if (request.method == "GET") {
			const q = QueryString.parse (url.query);
			if (typeof q[SystemInterface.Constant.UrlQueryParameter] == "string") {
				execute (q[SystemInterface.Constant.UrlQueryParameter]);
			}
			else {
				execute (q);
			}
		}
		else if (request.method == "POST") {
			body = [ ];
			request.on ("data", (chunk) => {
				body.push (chunk);
			});
			request.on ("end", () => {
				body = Buffer.concat (body).toString ();
				execute (body);
			});
		}
		else {
			this.writeResponse (request, response, 405);
		}
	}

	// End an HTTP request by writing the provided response code and data. If responseData is not provided, write a default response based on responseCode.
	writeResponse (request, response, responseCode, responseData) {
		let buffer;

		if (responseData === undefined) {
			switch (responseCode) {
				case 200: {
					responseData = "OK";
					break;
				}
				case 400: {
					responseData = "Bad request";
					break;
				}
				case 401: {
					responseData = "Unauthorized";
					break;
				}
				case 404: {
					responseData = "Not found";
					break;
				}
				case 405: {
					responseData = "Method not allowed";
					break;
				}
				case 500: {
					responseData = "Internal server error";
					break;
				}
				default: {
					responseData = "";
					break;
				}
			}
		}
		if (Buffer.isBuffer (responseData)) {
			buffer = responseData;
		}
		else if (typeof responseData == "string") {
			buffer = Buffer.from (responseData, "UTF-8");
		}
		else if (typeof responseData == "object") {
			buffer = Buffer.from (JSON.stringify (responseData), "UTF-8");
		}
		else {
			buffer = Buffer.from (`${responseData}`, "UTF-8");
		}

		response.statusCode = responseCode;
		response.setHeader ("Access-Control-Allow-Origin", "*");
		response.setHeader ("Content-Length", buffer.length);
		Log.debug2 (`HTTP ${responseCode}; client=${request.socket.remoteAddress}:${request.socket.remotePort} method=${request.method} url=${request.url} responseLength=${buffer.length}`);
		if (buffer.length > 0) {
			response.write (buffer);
		}
		response.end ();
	}

	// End an HTTP request by writing response data from a command invocation
	writeCommandResponse (request, response, cmdInv) {
		if ((cmdInv == null) || (typeof cmdInv != "object") || SystemInterface.isError (cmdInv)) {
			this.writeResponse (request, response, 500);
			return;
		}

		response.setHeader ("Content-Type", "application/json");
		this.writeResponse (request, response, 200, cmdInv);
	}

	// End an HTTP request by writing response data from a file
	writeFileResponse (request, response, filePath, contentType) {
		Fs.stat (filePath, (err, stats) => {
			let isopen;

			if (err != null) {
				Log.debug (`Error reading HTTP response file; url=${request.url} path=${filePath} err=${err}`);
				this.writeResponse (request, response, 404);
				return;
			}

			if (! stats.isFile ()) {
				Log.debug (`Error reading HTTP response file; url=${request.url} path=${filePath} err=Not a regular file`);
				this.writeResponse (request, response, 404);
				return;
			}

			isopen = false;
			const stream = Fs.createReadStream (filePath, { });
			stream.on ("error", (err) => {
				Log.debug (`Error reading HTTP response file; url=${request.url} path=${filePath} err=${err}`);
				if (! isopen) {
					this.writeResponse (request, response, 500);
				}
			});

			stream.on ("open", () => {
				if (isopen) {
					return;
				}

				isopen = true;
				response.statusCode = 200;
				if ((typeof contentType == "string") && (contentType != "")) {
					response.setHeader ("Content-Type", contentType);
				}
				response.setHeader ("Content-Length", stats.size);
				Log.debug3 (`HTTP 200 file response; client=${request.socket.remoteAddress}:${request.socket.remotePort} method=${request.method} url=${request.url} path=${filePath} contentType=${contentType} size=${stats.size}`);
				stream.pipe (response);
				stream.once ("close", () => {
					response.end ();
				});

				response.socket.setMaxListeners (0);
				response.socket.once ("error", (err) => {
					Log.debug (`Error writing HTTP response file; url=${request.url} path=${filePath} err=${err}`);
					stream.close ();
				});
			});
		});
	}

	// Set a request handler for the specified path. If a request with this path is received on the main HTTP server, the handler function is invoked with parameters (cmdInv, request, response).
	addMainRequestHandler (path, handler) {
		this.mainRequestHandlerMap[path] = handler;
	}

	// Set an invocation handler for the specified authorize path
	setAuthInvokeRequestHandler (path) {
		if (this.authorizePath != "") {
			this.removeInvokeRequestHandler (this.authorizePath, SystemInterface.Constant.DefaultCommandType);
		}
		this.authorizePath = path;
		if (this.authorizePath.indexOf ("/") != 0) {
			this.authorizePath = `/${this.authorizePath}`;
		}
		this.addInvokeRequestHandler (this.authorizePath, SystemInterface.Constant.DefaultCommandType, (cmdInv, request, response) => {
			switch (cmdInv.command) {
				case SystemInterface.CommandId.Authorize: {
					this.writeCommandResponse (request, response, this.accessControl.authorize (cmdInv));
					break;
				}
				default: {
					this.writeResponse (request, response, 400);
					break;
				}
			}
		});
	}

	// Set an invocation handler for the specified path and command type. If a matching request is received, the handler function is invoked with parameters (cmdInv, request, response).
	addInvokeRequestHandler (path, commandType, handler) {
		this.invokeRequestHandlerMap[`${commandType}:${path}`] = handler;
	}

	// Remove a previously added invocation handler
	removeInvokeRequestHandler (path, commandType) {
		delete (this.invokeRequestHandlerMap[`${commandType}:${path}`]);
	}

	// Set a request handler for the specified path. If a request with this path is received on the secondary HTTP server, the handler function is invoked with parameters (cmdInv, request, response).
	addSecondaryRequestHandler (urlPath, handler) {
		if (urlPath.indexOf ("/") != 0) {
			urlPath = `/${urlPath}`;
		}
		this.secondaryRequestHandlerMap[urlPath] = handler;
		this.shouldResetNetworkServers = true;
	}

	// Set a main server webroot handler for the specified URL path and file path, relative to the application webroot directory
	addMainWebroot (urlPath, filePath) {
		if (urlPath.indexOf ("/") != 0) {
			urlPath = `/${urlPath}`;
		}
		if (typeof filePath != "string") {
			filePath = urlPath;
		}
		this.mainWebrootMap[urlPath] = filePath;
	}

	// Set a secondary server webroot handler for the specified URL path and file path, relative to the application webroot directory
	addSecondaryWebroot (urlPath, filePath) {
		if (urlPath.indexOf ("/") != 0) {
			urlPath = `/${urlPath}`;
		}
		if (typeof filePath != "string") {
			filePath = urlPath;
		}
		this.secondaryWebrootMap[urlPath] = filePath;
		this.shouldResetNetworkServers = true;
	}

	// Set a handler for link commands of the specified type. If a matching request is received, the handler function is invoked with parameters (cmdInv, client).
	addLinkCommandHandler (commandType, handler) {
		this.linkCommandHandlerMap[commandType] = handler;
	}

	// Notify the agent that it should maintain a running data store process. If runCallback is provided, invoke it the next time the data store becomes available.
	runDataStore (runCallback) {
		++(this.dataStoreRunCount);
		if (this.dataStoreRunCount < 1) {
			this.dataStoreRunCount = 1;
		}
		if (this.isStarted) {
			this.runDataStoreTask.setRepeating ((callback) => {
				this.runDataStoreProcess (callback);
			}, App.StoreRunPeriod * 1000, App.StoreRunPeriod * 1000);
		}

		if (typeof runCallback == "function") {
			if ((this.dataStore != null) && this.dataStore.isRunning) {
				process.nextTick (runCallback);
			}
			else {
				this.runDataStoreEventEmitter.once (StartEvent, runCallback);
			}
		}
	}

	// Run the data store process if it's not already running and invoke runCallback when complete
	runDataStoreProcess (runCallback) {
		if (this.dataStore != null) {
			if (this.dataStore.isRunning) {
				process.nextTick (runCallback);
				return;
			}
		}

		this.dataStore = new DataStore (App.MongodPath, Path.join (App.DATA_DIRECTORY, "records"), App.StorePort);
		this.dataStore.run ().then (() => {
			this.runDataStoreEventEmitter.emit (StartEvent);
			runCallback ();
		}).catch ((err) => {
			Log.err (`Failed to start data store process; runPath="${App.MongodPath}" err=${err}`);
			runCallback ();
		});
	}

	// Notify the agent that it should stop maintaining a previously requested data store process
	stopDataStore () {
		--(this.dataStoreRunCount);
		if (this.dataStoreRunCount < 0) {
			this.dataStoreRunCount = 0;
		}
		if (this.dataStoreRunCount <= 0) {
			this.runDataStoreTask.stop ();
			if (this.dataStore != null) {
				this.dataStore.stop ();
				this.dataStore = null;
			}
		}
	}

	// Return a promise that opens the data store and resolves with the resulting DataStore object, or rejects if the data store could not opened
	openDataStore () {
		return (new Promise ((resolve, reject) => {
			const ds = this.dataStore;
			if (ds == null) {
				reject (Error ("DataStore not available"));
				return;
			}

			ds.open ().then (() => {
				resolve (ds);
			}).catch ((err) => {
				reject (err);
			});
		}));
	}

	// Return a promise that checks for an available memory filesystem and assigns the memoryFilePath data member to a non-empty value if successful
	openMemoryFilePath () {
		return (new Promise ((resolve, reject) => {
			let path;

			if (process.platform != "linux") {
				this.memoryFilePath = "";
				resolve ();
				return;
			}

			setTimeout (() => {
				// User-specific tmpfs directory, available on Raspbian and other Linux systems
				path = Path.join (Path.sep, "run", "user", `${process.getuid ()}`);
				Fs.stat (path, statComplete);
			}, 0);
			const statComplete = (err, stats) => {
				if (err != null) {
					Log.debug (`Memory file system not available; err=${err}`);
					this.memoryFilePath = "";
					resolve ();
					return;
				}

				if (! stats.isDirectory ()) {
					Log.debug (`Memory file system not available; err=${path} is not a directory`);
					this.memoryFilePath = "";
					resolve ();
					return;
				}

				path = Path.join (path, "membrane-server");
				FsUtil.createDirectory (path, createDirectoryComplete);
			};

			const createDirectoryComplete = (err) => {
				if (err != null) {
					Log.debug (`Memory file system not available; err=${err}`);
					this.memoryFilePath = "";
					resolve ();
					return;
				}

				this.memoryFilePath = path;
				Log.debug (`Memory file system open; path=${path}`);
				resolve ();
			};
		}));
	}

	// Copy fields from the provided object into the agent's run state and execute a write operation to persist the change. If endCallback is provided, invoke it when the write operation completes.
	updateRunState (fields, endCallback) {
		for (const i in fields) {
			this.runState[i] = fields[i];
		}

		if (typeof endCallback != "function") {
			endCallback = () => { };
		}
		FsUtil.writeStateFile (this.runStatePath, this.runState, endCallback);
	}

	// Execute actions appropriate for current networking state and invoke endCallback when complete
	updateNetwork (endCallback) {
		let shouldreset;

		shouldreset = false;
		const addressmap = { };
		const broadcastmap = { };
		const interfaces = Os.networkInterfaces ();
		for (const name in interfaces) {
			for (const addr of interfaces[name]) {
				if (addr.internal) {
					continue;
				}
				if (addr.family != "IPv4") {
					// TODO: Possibly support IPv6 interface addresses
					continue;
				}
				addressmap[name] = addr.address;

				const ip = new Ipv4Address (addr.address);
				ip.setNetmask (addr.netmask);
				broadcastmap[name] = ip.getBroadcastAddress ();
				break;
			}
		}
		if (this.shouldResetNetworkServers || (Object.keys (addressmap).length != Object.keys (this.networkAddressMap).length)) {
			shouldreset = true;
		}
		else {
			for (const name in addressmap) {
				if ((addressmap[name] !== this.networkAddressMap[name]) || (broadcastmap[name] !== this.broadcastAddressMap[name])) {
					shouldreset = true;
				}
			}
		}
		this.networkAddressMap = addressmap;
		this.broadcastAddressMap = broadcastmap;

		if (! shouldreset) {
			process.nextTick (endCallback);
			return;
		}

		Log.debug2 (`Reset network resources; networkAddresses=${JSON.stringify (this.networkAddressMap)} broadcastAddresses=${JSON.stringify (this.broadcastAddressMap)}`);
		this.shouldResetNetworkServers = false;
		this.closeMainHttpServer ().then (() => {
			return (this.closeSecondaryHttpServer ());
		}).then (() => {
			return (this.closeDatagramSocket ());
		}).then (() => {
			return (this.startMainHttpServer ());
		}).then (() => {
			if ((Object.keys (this.secondaryRequestHandlerMap).length > 0) || (Object.keys (this.secondaryWebrootMap).length > 0)) {
				return (this.startSecondaryHttpServer ());
			}
		}).then (() => {
			return (this.startDatagramSocket ());
		}).catch ((err) => {
			Log.err (`Failed to start network servers; err=${err}`);
		}).then (() => {
			endCallback ();
		});
	}

	// Execute actions to emit status update events if needed and invoke endCallback when complete
	emitAgentStatus (endCallback) {
		let shouldwrite;

		const agentstatus = this.getStatus ();
		if (agentstatus != null) {
			if (this.lastAgentStatus != null) {
				shouldwrite = (agentstatus.params.taskCount !== this.lastAgentStatus.params.taskCount) ||
					(agentstatus.params.runCount !== this.lastAgentStatus.params.runCount) ||
					(agentstatus.params.runTaskName !== this.lastAgentStatus.params.runTaskName) ||
					(agentstatus.params.runTaskSubtitle !== this.lastAgentStatus.params.runTaskSubtitle) ||
					(agentstatus.params.runTaskPercentComplete !== this.lastAgentStatus.params.runTaskPercentComplete);

				for (const server of this.serverList) {
					if (server.findStatusChange (agentstatus)) {
						shouldwrite = true;
					}
				}

				if (shouldwrite) {
					this.agentStatusEventEmitter.emit (AgentStatusEvent, agentstatus);
				}
			}
			this.lastAgentStatus = agentstatus;
		}

		process.nextTick (endCallback);
	}

	// Execute actions appropriate for a received datagram message
	handleDatagramMessage (msg) {
		const cmd = SystemInterface.parseCommand (msg.toString ());
		if (SystemInterface.isError (cmd)) {
			return;
		}

		switch (cmd.command) {
			case SystemInterface.CommandId.ReportStatus: {
				let statuscmd;

				const desturl = cmd.params.destination;
				const url = Url.parse (cmd.params.destination);
				if (url == null) {
					break;
				}

				if (url.protocol.match (/^udp(:){0,1}/)) {
					statuscmd = this.getStatus ();
					if (statuscmd != null) {
						statuscmd.commandType = cmd.params.reportCommandType;
						statuscmd = Buffer.from (JSON.stringify (statuscmd));
						this.datagramSocket.send (statuscmd, 0, statuscmd.length, url.port, url.hostname);
					}
				}
				else if (url.protocol.match (/^http(:){0,1}/)) {
					statuscmd = this.getStatus ();
					if (statuscmd != null) {
						statuscmd.commandType = cmd.params.reportCommandType;
						statuscmd = JSON.stringify (statuscmd);
						this.sendHttpPost (desturl, statuscmd);
					}
				}
				else {
					Log.debug (`ReportStatus discarded; err=Unknown destination protocol ${url.protocol}`);
				}
				break;
			}
			case SystemInterface.CommandId.ReportContact: {
				let contactcmd;

				const desturl = cmd.params.destination;
				const url = Url.parse (cmd.params.destination);
				if (url == null) {
					break;
				}

				if (url.protocol.match (/^udp(:){0,1}/)) {
					contactcmd = this.getContact ();
					if (contactcmd != null) {
						contactcmd.commandType = cmd.params.reportCommandType;
						contactcmd = Buffer.from (JSON.stringify (contactcmd));
						this.datagramSocket.send (contactcmd, 0, contactcmd.length, url.port, url.hostname);
					}
				}
				else if (url.protocol.match (/^http(:){0,1}/)) {
					contactcmd = this.getContact ();
					if (contactcmd != null) {
						contactcmd.commandType = cmd.params.reportCommandType;
						contactcmd = JSON.stringify (contactcmd);
						this.sendHttpPost (desturl, contactcmd);
					}
				}
				else {
					Log.debug (`ReportContact discarded; err=Unknown destination protocol ${url.protocol}`);
				}
				break;
			}
			default: {
				break;
			}
		}
	}

	// Send a broadcast message using the provided string or Buffer value. Returns a boolean value indicating if the message was sent.
	sendBroadcast (message) {
		if (! this.isBroadcastReady) {
			return (false);
		}

		if (typeof message == "string") {
			message = Buffer.from (message);
		}
		for (const address of Object.values (this.broadcastAddressMap)) {
			this.datagramSocket.send (message, 0, message.length, SystemInterface.Constant.DefaultUdpPort, address);
		}
		return (true);
	}

	// Send a message using an HTTP POST request and the provided string or Buffer value
	sendHttpPost (postUrl, message) {
		let url;

		url = postUrl;
		if (typeof url == "string") {
			url = Url.parse (url);
			if (url == null) {
				Log.debug (`Failed to send HTTP POST request; err=Invalid URL, ${postUrl}`);
				return;
			}
		}

		const postdata = message;
		const req = Http.request ({
			hostname: url.hostname,
			port: url.port,
			path: url.path,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Content-Length": postdata.length,
				"User-Agent": this.userAgent
			}
		}, (response) => {
		});
		req.on ("error", (err) => {
			Log.debug (`Error sending HTTP POST request; err=${err} postUrl=${postUrl}`);
		});

		req.write (postdata);
		req.end ();
	}

	// Return an AgentStatus command that reflects current state, or null if the command could not be created
	getStatus () {
		const params = {
			id: this.agentId,
			displayName: this.displayName,
			applicationName: this.applicationName,
			urlHostname: this.urlHostname,
			tcpPort1: this.httpServerPort1,
			tcpPort2: this.httpServerPort2,
			udpPort: this.datagramSocketPort,
			linkPath: this.linkPath,
			uptime: StringUtil.getDurationString (Date.now () - this.startTime),
			version: App.VERSION,
			nodeVersion: process.version,
			platform: App.AGENT_PLATFORM,
			isEnabled: this.isEnabled,
			taskCount: this.taskGroup.taskCount,
			runCount: this.taskGroup.runCount,
			maxRunCount: this.taskGroup.maxRunCount
		};
		if (this.taskGroup.runTaskName != "") {
			params.runTaskName = this.taskGroup.runTaskName;
			params.runTaskSubtitle = this.taskGroup.runTaskSubtitle;
			params.runTaskPercentComplete = this.taskGroup.runTaskPercentComplete;
		}
		for (const server of this.serverList) {
			server.setStatus (params);
		}

		const cmd = SystemInterface.createCommand (this.getCommandPrefix (), "AgentStatus", SystemInterface.Constant.DefaultCommandType, params);
		if (SystemInterface.isError (cmd)) {
			Log.err (`Failed to create agent status command; err=${cmd}`);
			return (null);
		}

		return (cmd);
	}

	// Return an AgentConfiguration command that reflects current state, or null if the command could not be created
	getConfiguration () {
		const params = { };
		for (const server of this.serverList) {
			server.getConfiguration (params);
		}
		params.isEnabled = this.isEnabled;
		params.displayName = this.displayName;

		return (this.createCommand ("AgentConfiguration", SystemInterface.Constant.DefaultCommandType, params));
	}

	// Return an AgentContact command that reflects current state, or null if the contact command could not be created. The generated command uses a default prefix with empty fields to yield a shorter message.
	getContact () {
		const params = {
			id: this.agentId,
			urlHostname: this.urlHostname,
			tcpPort1: this.httpServerPort1,
			tcpPort2: this.httpServerPort2,
			udpPort: this.datagramSocketPort,
			version: App.VERSION,
			nodeVersion: process.version
		};

		return (this.createCommand ("AgentContact", SystemInterface.Constant.DefaultCommandType, params));
	}

	// Return a string containing a newly generated UUID value that references the specified SystemInterface command type
	getUuid (idType) {
		let uuid, id;

		if (typeof idType != "number") {
			idType = 0;
		}
		if (idType < 0) {
			idType = 0;
		}
		if (idType > 0xFFFF) {
			idType = 0xFFFF;
		}

		id = Date.now ();
		id = Math.floor (id / 1000);
		id = id.toString (16);
		while (id.length < 12) {
			id = `0${id}`;
		}
		uuid = id.substring (0, 8);
		uuid += `-${id.substring (8, 12)}`;

		id = idType.toString (16);
		while (id.length < 4) {
			id = `0${id}`;
		}
		uuid += `-${id}`;

		const chars = [ "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f" ];
		id = "";
		while (id.length < 16) {
			id += chars[Math.floor (Math.random () * chars.length)];
		}
		uuid += `-${id.substring (0, 4)}`;
		uuid += `-${id.substring (4, 16)}`;

		return (uuid);
	}

	// Return the command type assigned to the specified UUID value, or -1 if no command type was found
	getUuidCommand (id) {
		const matches = id.match (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-([0-9a-fA-F]{4})-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
		if (matches == null) {
			return (-1);
		}

		const cmd = parseInt (matches[1], 16);
		if (isNaN (cmd)) {
			return (-1);
		}

		return (cmd);
	}

	// Return a SystemInterface command prefix object, suitable for use with the getCommandInvocation method
	getCommandPrefix (priority, startTime, duration) {
		const prefix = { };
		prefix[SystemInterface.Constant.CreateTimePrefixField] = Date.now ();
		prefix[SystemInterface.Constant.AgentIdPrefixField] = this.agentId;
		if (typeof priority == "number") {
			if (priority < 0) {
				priority = 0;
			}
			if (priority > SystemInterface.MaxCommandPriority) {
				priority = SystemInterface.MaxCommandPriority;
			}
			prefix[SystemInterface.Constant.PriorityPrefixField] = Math.floor (priority);
		}

		if (typeof startTime == "number") {
			if (startTime < 0) {
				startTime = 0;
			}
			prefix[SystemInterface.Constant.StartTimePrefixField] = Math.floor (startTime);
		}

		if (typeof duration == "number") {
			if (duration < 0) {
				duration = 0;
			}
			prefix[SystemInterface.Constant.DurationPrefixField] = Math.floor (duration);
		}

		return (prefix);
	}

	// Populate prefix authorization fields in a command object
	setCommandAuthorization (cmdInv, authorizeSecret, authorizeToken) {
		const hash = Crypto.createHash (SystemInterface.Constant.AuthorizationHashAlgorithm);
		SystemInterface.setCommandAuthorization (cmdInv, authorizeSecret, authorizeToken,
			(data) => {
				hash.update (data);
			},
			() => {
				return (hash.digest ("hex"));
			}
		);
	}

	// Return a command with the default agent prefix and the provided parameters, or null if the command could not be validated, in which case an error log message is generated
	createCommand (commandName, commandType, commandParams, authorizeSecret, authorizeToken) {
		const cmd = SystemInterface.createCommand (this.getCommandPrefix (), commandName, commandType, commandParams);
		if (SystemInterface.isError (cmd)) {
			Log.err (`Failed to create command invocation; commandName=${commandName} err=${cmd}`);
			return (null);
		}

		if ((typeof authorizeSecret == "string") && (authorizeSecret != "")) {
			this.setCommandAuthorization (cmd, authorizeSecret, authorizeToken);
		}

		return (cmd);
	}

	// Execute a command invocation on a remote agent and invoke endCallback (err, responseCommand) when complete. If endCallback is not provided, instead return a Promise that executes the operation.
	invokeAgentCommand (urlHostname, tcpPort, invokePath, cmdInv, responseCommandId, endCallback) {
		const execute = (executeCallback) => {
			let options, req, path, body;

			if (SystemInterface.isError (cmdInv)) {
				if (executeCallback != null) {
					process.nextTick (() => {
						executeCallback (`Invalid command: ${cmdInv}`, null);
					});
				}
				return;
			}

			body = "";
			setTimeout (() => {
				path = invokePath;
				if (path.indexOf ("/") != 0) {
					path = `/${path}`;
				}
				path += `?${SystemInterface.Constant.UrlQueryParameter}=${encodeURIComponent (JSON.stringify (cmdInv))}`;
				options = {
					method: "GET",
					hostname: urlHostname,
					port: tcpPort,
					path: path,
					headers: {
						"User-Agent": this.userAgent
					}
				};
				if (App.EnableHttps) {
					options.protocol = "https:";
					options.agent = new Https.Agent ({
						// TODO: Possibly set the "ca" option (certificate authority block) here instead of rejectUnauthorized, i.e. Fs.readFileSync ("tls-cert.pem")
						rejectUnauthorized: false
					});
					req = Https.request (options, requestStarted);
				}
				else {
					options.protocol = "http:";
					req = Http.request (options, requestStarted);
				}
				req.on ("error", (err) => {
					endRequest (err, null);
				});

				req.end ();
			}, 0);

			const requestStarted = (res) => {
				if (res.statusCode != 200) {
					endRequest (`Non-success response code ${res.statusCode}`, null);
					return;
				}
				res.on ("error", (err) => {
					endRequest (err, null);
				});
				res.on ("data", (data) => {
					body += data;
				});
				res.on ("end", () => {
					endRequest (null, body);
				});
			};

			const endRequest = (err, data) => {
				let responsecmd;

				if (executeCallback != null) {
					responsecmd = null;
					if (err == null) {
						responsecmd = SystemInterface.parseCommand (data);
						if (SystemInterface.isError (responsecmd)) {
							err = `Response for ${cmdInv.commandName} contained invalid command invocation, ${responsecmd}`;
							responsecmd = null;
						}
					}

					if ((err == null) && (typeof responseCommandId == "number")) {
						if (responsecmd.command != responseCommandId) {
							err = `Response for ${cmdInv.commandName} contained invalid command type ${responsecmd.command}, expected ${responseCommandId}`;
							responsecmd = null;
						}
					}

					executeCallback (err, responsecmd);
					executeCallback = null;
				}
			};
		};

		if (typeof endCallback == "function") {
			execute (endCallback);
		}
		else {
			return (new Promise ((resolve, reject) => {
				execute ((err, responseCommand) => {
					if (err != null) {
						reject (Error (err));
						return;
					}
					resolve (responseCommand);
				});
			}));
		}
	}

	// Return a promise that invokes a command using the invoke request handler map. If responseCommandId is provided, the response command must match that type.
	invokeCommand (invokePath, cmdInv, responseCommandId) {
		const fn = this.invokeRequestHandlerMap[`${cmdInv.commandType}:${invokePath}`];
		if (fn == null) {
			return (Promise.reject (Error ("Path not found")));
		}

		return (new Promise ((resolve, reject) => {
			let responsedata;

			responsedata = "";
			const request = new EventEmitter ();
			request.url = "/";
			request.method = "GET";
			request.socket = {
				remoteAddress: "invokeCommand",
				remotePort: 0
			};

			const response = new EventEmitter ();
			response.statusCode = 0;
			response.socket = new EventEmitter ();
			response.setHeader = (key, value) => {
			};
			response.write = (buffer) => {
				responsedata += buffer.toString ();
			};
			response.end = () => {
				if (responsedata.length <= 0) {
					reject (Error ("No response data"));
					return;
				}

				const responsecmd = SystemInterface.parseCommand (responsedata);
				if (SystemInterface.isError (responsecmd)) {
					reject (Error ("Non-parsing response data"));
					return;
				}

				if ((typeof responseCommandId == "number") && (responsecmd.command != responseCommandId)) {
					reject (Error (`Invalid response command type ${responsecmd.command}, expected ${responseCommandId}`));
					return;
				}

				resolve (responsecmd);
			};

			fn (cmdInv, request, response);
		}));
	}

	// Execute an HTTP GET operation for the provided URL and save response data into the specified path. Invokes endCallback (err, destFilename) when complete. If endCallback is not provided, instead return a Promise that executes the operation.
	fetchUrlFile (targetUrl, targetDirectory, targetFilename, endCallback) {
		const execute = (executeCallback) => {
			let url, httpreq, httpres, stream, tempfilename, destfilename;

			url = targetUrl;
			if (typeof url == "string") {
				url = Url.parse (url);
				if (url == null) {
					executeCallback (`Invalid URL, ${targetUrl}`, null);
					return;
				}
			}

			destfilename = null;
			Log.debug2 (`fetchUrlFile; targetUrl=${targetUrl} targetDirectory=${targetDirectory} targetFilename=${targetFilename}`);
			Fs.stat (targetDirectory, (err, stats) => {
				if (err != null) {
					executeCallback (err, null);
					return;
				}
				if (! stats.isDirectory ()) {
					executeCallback (`${targetDirectory} exists but is not a directory`, null);
					return;
				}
				assignTempFilePath ();
			});

			const assignTempFilePath = () => {
				tempfilename = Path.join (targetDirectory, `urldata_${Date.now ()}_${App.systemAgent.getRandomString (16)}`);
				Fs.stat (tempfilename, statTempFilePathComplete);
			};

			const statTempFilePathComplete = (err, stats) => {
				if ((err != null) && (err.code != "ENOENT")) {
					executeCallback (err, null);
					return;
				}

				if (stats != null) {
					assignTempFilePath ();
					return;
				}

				stream = Fs.createWriteStream (tempfilename);
				stream.on ("open", fileOpened);
				stream.once ("error", fileError);
			};

			const fileError = (err) => {
				stream.close ();
				endRequest (err);
			};

			const fileOpened = () => {
				const options = {
					hostname: url.hostname,
					port: url.port,
					path: url.path,
					method: "GET",
					headers: {
						"User-Agent": App.systemAgent.userAgent
					}
				};
				try {
					httpreq = Http.get (options, requestStarted);
				}
				catch (e) {
					endRequest (e);
					return;
				}
				httpreq.on ("error", (err) => {
					endRequest (err);
				});
			};

			const requestStarted = (res) => {
				let matchresult;

				httpres = res;
				if (httpres.statusCode != 200) {
					endRequest (`Non-success response code ${httpres.statusCode}`);
					return;
				}

				if (typeof targetFilename == "string") {
					destfilename = Path.join (targetDirectory, targetFilename);
				}

				if (destfilename == null) {
					const val = httpres.headers["content-disposition"];
					if (typeof val == "string") {
						matchresult = val.match (/^attachment; filename=(.*)/);
						if (matchresult != null) {
							destfilename = Path.join (targetDirectory, matchresult[1]);
						}
					}
				}

				httpres.once ("error", (err) => {
					endRequest (err);
				});
				httpres.on ("data", (data) => {
					stream.write (data);
				});
				httpres.on ("end", responseComplete);
			};

			const responseComplete = () => {
				stream.end ();
				stream.once ("finish", streamFinished)
			};

			const streamFinished = () => {
				endRequest (null);
			};

			const endRequest = (err) => {
				if (err != null) {
					Fs.unlink (tempfilename, () => { });
					executeCallback (err, null);
					return;
				}

				if (destfilename == null) {
					// TODO: Rename the target file by parsing the last section of the URL path
					executeCallback (null, tempfilename);
					return;
				}

				Fs.rename (tempfilename, destfilename, renameComplete);
			};

			const renameComplete = (err) => {
				if (err != null) {
					Fs.unlink (tempfilename, () => { });
					executeCallback (err, null);
					return;
				}

				executeCallback (null, destfilename);
			};
		};

		if (typeof endCallback == "function") {
			execute (endCallback);
		}
		else {
			return (new Promise ((resolve, reject) => {
				execute ((err, destFile) => {
					if (err != null) {
						reject (Error (err));
						return;
					}
					resolve (destFile);
				});
			}));
		}
	}

	// Execute an HTTP GET operation for the provided URL and save response data into a string. Invokes endCallback (err, urlData) when complete. If endCallback is not provided, instead return a Promise that executes the operation.
	fetchUrlData (targetUrl, endCallback) {
		const execute = (executeCallback) => {
			let url, urldata;

			url = targetUrl;
			if (typeof url == "string") {
				url = Url.parse (url);
				if (url == null) {
					executeCallback (`Invalid URL, ${targetUrl}`, null);
					return;
				}
			}

			urldata = "";
			const options = {
				hostname: url.hostname,
				port: url.port,
				path: url.path,
				method: "GET",
				headers: {
					"User-Agent": this.userAgent
				}
			};

			const readCaFileComplete = (err, data) => {
				if (err != null) {
					Log.debug (`Failed to read TLS ca file; path=${App.TlsCaPath} err=${err}`);
				}
				else if (data == null) {
					Log.debug (`Failed to read TLS ca file; path=${App.TlsCaPath} err="No file data"`);
				}
				else {
					const ca = data.toString ();
					if (ca.length > 0) {
						options.agent = new Https.Agent ({
							ca: [ ca ],
							rejectUnauthorized: true
						});
					}
				}
				createRequest ();
			};

			const createRequest = () => {
				let req;

				try {
					if (options.protocol == "https:") {
						req = Https.get (options, requestStarted);
					}
					else {
						req = Http.get (options, requestStarted);
					}
				}
				catch (e) {
					endRequest (e);
					return;
				}
				req.on ("error", (err) => {
					endRequest (err);
				});
			};

			const requestStarted = (res) => {
				if (res.statusCode != 200) {
					endRequest (`Non-success response code ${res.statusCode}`);
					return;
				}
				res.once ("error", (err) => {
					endRequest (err);
				});
				res.on ("data", (data) => {
					urldata += data.toString ();
				});
				res.on ("end", () => {
					endRequest (null);
				});
			};

			const endRequest = (err) => {
				if (err != null) {
					executeCallback (err, null);
					return;
				}
				executeCallback (null, urldata);
			};

			Log.debug2 (`fetchUrlData; targetUrl=${targetUrl}`);
			if (url.protocol.match (/^https(:){0,1}/)) {
				options.protocol = "https:";
				Fs.readFile (App.TlsCaPath, readCaFileComplete);
			}
			else {
				createRequest ();
			}
		};

		if (typeof endCallback == "function") {
			execute (endCallback);
		}
		else {
			return (new Promise ((resolve, reject) => {
				execute ((err, urlData) => {
					if (err != null) {
						reject (Error (err));
						return;
					}
					resolve (urlData);
				});
			}));
		}
	}

	// Return a randomly generated string of characters using the specified length
	getRandomString (length) {
		let s;

		const chars = [ "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9" ];
		s = "";
		while (s.length < length) {
			s += chars[Math.floor (Math.random () * chars.length)];
		}

		return (s);
	}

	// Return a randomly selected integer number in the provided inclusive range
	getRandomInteger (min, max) {
		if (max <= min) {
			return (Math.floor (max));
		}

		return (Math.round (min + (Math.random () * (max - min))));
	}

	// Return a number value specifying a millisecond delay, suitable for use as a heartbeat period
	getHeartbeatDelay () {
		let delay;

		delay = App.HeartbeatPeriod;
		delay += Math.floor (Math.random () * 128);

		return (delay);
	}

	// Return a newly created ExecProcess object that launches openssl. workingPath defaults to the application data directory if empty.
	createOpensslProcess (runArgs, workingPath, processData, processEnded) {
		let runpath;

		runpath = App.OpensslPath;
		const env = { };
		if (runpath == "") {
			if (process.platform == "win32") {
				runpath = "openssl.exe";
			}
			else if (process.platform == "linux") {
				runpath = "openssl/bin/openssl";
				env.LD_LIBRARY_PATH = `${App.BIN_DIRECTORY}/openssl/lib`;
			}
			else {
				runpath = "openssl";
			}
		}

		return (new ExecProcess (runpath, runArgs, env, workingPath, processData, processEnded));
	}

	// Return a promise that executes a child process and resolves with the process isExitSuccess value if successful
	runProcess (execPath, execArgs, envParams, workingPath, dataCallback) {
		return (new Promise ((resolve, reject) => {
			new ExecProcess (execPath, execArgs, envParams, workingPath, (lines, lineCallback) => {
				if (typeof dataCallback != "function") {
					process.nextTick (lineCallback);
					return;
				}
				dataCallback (lines, lineCallback);
			}, (err, isExitSuccess) => {
				if (err != null) {
					reject (Error (err));
					return;
				}

				resolve (isExitSuccess);
			});
		}));
	}
}
module.exports = SystemAgent;
