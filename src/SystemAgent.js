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
const Log = require (App.SOURCE_DIRECTORY + "/Log");
const Result = require (App.SOURCE_DIRECTORY + "/Result");
const FsUtil = require (App.SOURCE_DIRECTORY + "/FsUtil");
const Ipv4Address = require (App.SOURCE_DIRECTORY + "/Ipv4Address");
const Task = require (App.SOURCE_DIRECTORY + "/Task/Task");
const TaskGroup = require (App.SOURCE_DIRECTORY + "/Task/TaskGroup");
const RepeatTask = require (App.SOURCE_DIRECTORY + "/RepeatTask");
const IntentGroup = require (App.SOURCE_DIRECTORY + "/Intent/IntentGroup");
const SystemInterface = require (App.SOURCE_DIRECTORY + "/SystemInterface");
const DataStore = require (App.SOURCE_DIRECTORY + "/DataStore");
const AccessControl = require (App.SOURCE_DIRECTORY + "/AccessControl");
const ExecProcess = require (App.SOURCE_DIRECTORY + "/ExecProcess");
const Server = require (App.SOURCE_DIRECTORY + "/Server/Server");

const START_EVENT = "start";
const STOP_EVENT = "stop";
const WEBROOT_INDEX_FILENAME = "index.html";

class SystemAgent {
	constructor () {
		this.isEnabled = true;
		this.dataPath = App.DATA_DIRECTORY;
		this.runStatePath = this.dataPath + "/state";
		this.agentId = "";

		this.displayName = "";
		this.applicationName = "";
		this.urlHostname = "";
		this.memoryFilePath = "";

		this.isStarted = false;
		this.startTime = 0;
		this.httpServer1 = null;
		this.httpServerPort1 = 0;
		this.httpServer2 = null;
		this.httpServerPort2 = 0;
		this.linkPath = App.LINK_PATH;
		if (this.linkPath == "") {
			this.linkPath = this.getRandomString (32);
		}
		if (this.linkPath.indexOf ("/") != 0) {
			this.linkPath = "/" + this.linkPath;
		}

		this.isBroadcastReady = false;
		this.datagramSocket = null;
		this.datagramSocketPort = 0;
		this.updateDatagramSocketTask = new RepeatTask ();

		// A map of interface names to broadcast addresses for use by the datagram socket
		this.datagramBroadcastAddressMap = { };

		// A map of paths to functions for handling requests received by the main HTTP server
		this.mainRequestHandlerMap = { };

		// A map of paths to functions for handling requests received by the secondary HTTP server
		this.secondaryRequestHandlerMap = { };

		// A map of URL paths to filesystem paths that should be handled as webroot requests by the secondary HTTP server
		this.webrootMap = { };

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
		this.taskGroup.maxRunCount = App.MAX_TASK_COUNT;

		this.intentGroup = new IntentGroup ();
		this.intentGroup.writePeriod = App.INTENT_WRITE_PERIOD;

		this.dataStore = null;
		this.dataStoreRunCount = 0;
		this.runDataStoreTask = new RepeatTask ();
		this.runDataStoreEventEmitter = new EventEmitter ();
		this.runDataStoreEventEmitter.setMaxListeners (0);

		this.agentStopEventEmitter = new EventEmitter ();
		this.agentStopEventEmitter.setMaxListeners (0);
	}

	// Start the agent's operation and invoke startCompleteCallback (err) when complete
	start (startCompleteCallback) {
		let pos, server, serverconfigs;

		if (this.isStarted) {
			process.nextTick (function () {
				startCompleteCallback (null);
			});
			return;
		}

		this.isEnabled = App.AGENT_ENABLED;
		this.applicationName = App.AGENT_APPLICATION_NAME;

		if (App.AGENT_DISPLAY_NAME != null) {
			this.displayName = App.AGENT_DISPLAY_NAME;
		}
		else {
			this.displayName = Os.hostname ();
			pos = this.displayName.indexOf (".");
			if (pos > 0) {
				this.displayName = this.displayName.substring (0, pos);
			}
		}

		serverconfigs = FsUtil.readConfigFile ("conf/server.conf");
		if (serverconfigs == null) {
			serverconfigs = [ ];
		}
		if (serverconfigs.length <= 0) {
			Log.notice ("No server types configured, remote functionality may be limited");
		}

		for (let config of serverconfigs) {
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

		this.startTime = new Date ().getTime ();

		FsUtil.createDirectory (this.dataPath).then (() => {
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
			return (this.startMainHttpServer ());
		}).then (() => {
			let digest, len;

			if ((typeof this.runState.adminSecret == "string") && (this.runState.adminSecret != "")) {
				digest = this.runState.adminSecret;
				len = digest.length / 2;
				if (len <= 0) {
					App.AUTHORIZE_SECRET = digest;
					this.setAuthInvokeRequestHandler (SystemInterface.Constant.DefaultAuthorizePath);
				}
				else {
					App.AUTHORIZE_SECRET = digest.substring (0, len);
					this.setAuthInvokeRequestHandler (digest.substring (len));
				}
			}
			else {
				this.setAuthInvokeRequestHandler (App.AUTHORIZE_PATH);
			}

			this.accessControl.start ();
			this.taskGroup.start ();
			this.intentGroup.start ();
			if ((Object.keys (this.secondaryRequestHandlerMap).length > 0) || (Object.keys (this.webrootMap).length > 0)) {
				return (this.startSecondaryHttpServer ());
			}
		}).then (() => {
			if (this.dataStoreRunCount > 0) {
				this.dataStore = new DataStore (App.MONGOD_PATH, this.dataPath + "/records", App.STORE_PORT);
				return (this.dataStore.run ());
			}
		}).then (() => {
			return (this.openMemoryFilePath ());
		}).then (() => {
			this.addInvokeRequestHandler (SystemInterface.Constant.DefaultInvokePath, SystemInterface.Constant.DefaultCommandType, (cmdInv) => {
				switch (cmdInv.command) {
					case SystemInterface.CommandId.GetStatus: {
						return (this.getStatus ());
					}
					case SystemInterface.CommandId.GetAgentConfiguration: {
						return (this.getConfiguration ());
					}
					case SystemInterface.CommandId.UpdateAgentConfiguration: {
						let err, c;
						err = false;
						for (let server of this.serverList) {
							c = cmdInv.params.agentConfiguration[server.getAgentConfigurationKey ()];
							if ((typeof c == "object") && (c != null)) {
								if (! server.isConfigurationValid (c)) {
									err = true;
									break;
								}
							}
						}
						if (err) {
							return (SystemInterface.createCommand (this.getCommandPrefix (), "CommandResult", SystemInterface.Constant.DefaultCommandType, {
								success: false,
								error: "Invalid configuration parameters"
							}));
						}

						if ((typeof this.runState.agentConfiguration != "object") || (this.runState.agentConfiguration == null)) {
							this.runState.agentConfiguration = { };
						}
						for (let server of this.serverList) {
							c = cmdInv.params.agentConfiguration[server.getAgentConfigurationKey ()];
							if ((typeof c == "object") && (c != null)) {
								server.configure (c);
								this.runState.agentConfiguration[server.getAgentConfigurationKey ()] = c;
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

						FsUtil.writeStateFile (this.runStatePath, this.runState, function (err) {
							if (err != null) {
								Log.err (`Failed to write run state; path=${this.runStatePath} err=${err}`);
							}
						});
						return (this.getConfiguration ());
					}
					case SystemInterface.CommandId.ShutdownAgent: {
						Log.notice ("Shutdown application by remote command");

						this.stopAllServers (() => {
							process.exit (0);
						});
						return (SystemInterface.createCommand (this.getCommandPrefix (), "CommandResult", SystemInterface.Constant.DefaultCommandType, {
							success: true
						}));
					}
					case SystemInterface.CommandId.SetAdminSecret: {
						let hash, digest, len;

						if (cmdInv.params.secret == "") {
							Log.info ("Clear admin secret by remote command");
							this.setAuthInvokeRequestHandler (App.AUTHORIZE_PATH);
							App.AUTHORIZE_SECRET = "";
							this.updateRunState ({ adminSecret: "" });
						}
						else {
							Log.info ("Reset admin secret by remote command");

							hash = Crypto.createHash (SystemInterface.Constant.AuthorizationHashAlgorithm);
							hash.update (cmdInv.params.secret);
							digest = hash.digest ("hex");
							len = digest.length / 2;
							if (len <= 0) {
								App.AUTHORIZE_SECRET = digest;
								this.setAuthInvokeRequestHandler (SystemInterface.Constant.DefaultAuthorizePath);
							}
							else {
								App.AUTHORIZE_SECRET = digest.substring (0, len);
								this.setAuthInvokeRequestHandler (digest.substring (len));
							}
							this.updateRunState ({ adminSecret: digest });
						}
						return (SystemInterface.createCommand (this.getCommandPrefix (), "CommandResult", SystemInterface.Constant.DefaultCommandType, {
							success: true
						}));
					}
					case SystemInterface.CommandId.StartServers: {
						Log.notice ("Start all servers by remote command");
						this.startAllServers (() => { });
						return (SystemInterface.createCommand (this.getCommandPrefix (), "CommandResult", SystemInterface.Constant.DefaultCommandType, {
							success: true
						}));
					}
					case SystemInterface.CommandId.StopServers: {
						Log.notice ("Stop all servers by remote command");
						this.stopAllServers (() => { });
						return (SystemInterface.createCommand (this.getCommandPrefix (), "CommandResult", SystemInterface.Constant.DefaultCommandType, {
							success: true
						}));
					}
					case SystemInterface.CommandId.CancelTask: {
						this.taskGroup.cancelTask (cmdInv);
						return (SystemInterface.createCommand (this.getCommandPrefix (), "CommandResult", SystemInterface.Constant.DefaultCommandType, {
							success: true
						}));
					}
				}

				return (null);
			});

			this.addLinkCommandHandler (SystemInterface.Constant.Admin, (client, cmdInv) => {
				switch (cmdInv.command) {
					case SystemInterface.CommandId.ReadTasks: {
						this.taskGroup.readTasks (client, cmdInv);
						break;
					}
					case SystemInterface.CommandId.WatchTasks: {
						this.taskGroup.watchTasks (client, cmdInv);
						break;
					}
				}
			});

			this.updateDatagramSocketTask.setRepeating ((callback) => {
				this.updateDatagramSocket (callback);
			}, App.HEARTBEAT_PERIOD * 8, App.HEARTBEAT_PERIOD * 16);

			if (this.dataStoreRunCount > 0) {
				this.runDataStoreEventEmitter.emit (START_EVENT);
				this.runDataStoreTask.setRepeating ((callback) => {
					this.runDataStoreProcess (callback);
				}, App.STORE_RUN_PERIOD * 1000, App.STORE_RUN_PERIOD * 1000);
			}

			this.isStarted = true;
			startCompleteCallback ();
		}).catch ((err) => {
			this.accessControl.stop ();
			this.taskGroup.stop ();
			this.intentGroup.stop ();
			startCompleteCallback (err);
		});
	}

	// Return a promise that generates TLS configuration files if needed
	generateTlsConfig () {
		return (new Promise ((resolve, reject) => {
			let filenames, proc, argslist, statFilesComplete, execOpenssl, execComplete;

			setTimeout (() => {
				filenames = [
					Path.join (App.DATA_DIRECTORY, App.TLS_KEY_FILENAME),
					Path.join (App.DATA_DIRECTORY, App.TLS_CERT_FILENAME)
				];
				FsUtil.statFiles (filenames, (filename, stats) => {
					return (stats.isFile () && (stats.size > 0));
				}, statFilesComplete);
			}, 0);

			statFilesComplete = (err) => {
				if (err == null) {
					resolve ();
					return;
				}
				argslist = [
					[
						"genrsa",
						"-out", Path.join (App.DATA_DIRECTORY, App.TLS_KEY_FILENAME),
						"2048"
					],
					[
						"req",
						"-config", Path.join (App.BIN_DIRECTORY, App.OPENSSL_CONFIG_FILENAME),
						"-batch",
						"-new",
						"-sha256",
						"-key", Path.join (App.DATA_DIRECTORY, App.TLS_KEY_FILENAME),
						"-out", Path.join (App.DATA_DIRECTORY, App.TLS_CSR_FILENAME)
					],
					[
						"x509",
						"-req",
						"-days", "9125",
						"-in", Path.join (App.DATA_DIRECTORY, App.TLS_CSR_FILENAME),
						"-signkey", Path.join (App.DATA_DIRECTORY, App.TLS_KEY_FILENAME),
						"-out", Path.join (App.DATA_DIRECTORY, App.TLS_CERT_FILENAME)
					]
				];
				Async.eachSeries (argslist, execOpenssl, execComplete);
			};
			execOpenssl = (args, callback) => {
				proc = App.systemAgent.createOpensslProcess (args, App.DATA_DIRECTORY, null, (err, isExitSuccess) => {
					if (err != null) {
						callback (`Failed to generate TLS configuration; err=${err}`);
						return;
					}
					if (! isExitSuccess) {
						callback (`Failed to generate TLS configuration; err=openssl process ended with error`);
						return;
					}

					callback ();
				});
			};
			execComplete = (err) => {
				if (err != null) {
					reject (Error (err));
					return;
				}

				resolve ();
			};
		}));
	}

	// Return a promise that starts the main HTTP server if it isn't already running
	startMainHttpServer () {
		return (new Promise ((resolve, reject) => {
			let http, options, io, listenError, listenComplete, ioConnection;

			if (this.httpServer1 != null) {
				resolve ();
				return;
			}

			options = { };
			if (App.ENABLE_HTTPS) {
				try {
					options = {
						key: Fs.readFileSync (Path.join (App.DATA_DIRECTORY, App.TLS_KEY_FILENAME)),
						cert: Fs.readFileSync (Path.join (App.DATA_DIRECTORY, App.TLS_CERT_FILENAME))
					};
				}
				catch (e) {
					reject (Error (e));
					return;
				}
			}

			if (App.ENABLE_HTTPS) {
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
				http.listen (App.TCP_PORT1, null, 1024, listenComplete);
			}, 0);

			listenError = (err) => {
				http.removeListener ("error", listenError);
				reject (Error (err));
			};

			listenComplete = () => {
				let address;

				http.removeListener ("error", listenError);
				address = http.address ();
				if (typeof address.port != "number") {
					reject ("Internal error: failed to read listen port from HTTP server");
					return;
				}

				this.httpServerPort1 = address.port;
				this.resetUrlHostname ();
				Log.debug (`HTTP-1 listening; address=${this.urlHostname}:${this.httpServerPort1}`);
				http.on ("error", (err) => {
					Log.err (`HTTP-1 error; err=${err}`);
				});

				http.on ("close", () => {
					if (this.httpServer1 == http) {
						this.httpServer1 = null;
					}
				});

				io = Io.listen (http, { "path": this.linkPath });
				io.on ("connection", ioConnection);
				this.agentStopEventEmitter.once (STOP_EVENT, () => {
					io.close ();
				});

				resolve ();
			};

			ioConnection = (client) => {
				let clientaddress, token;

				clientaddress = client.request.connection.remoteAddress;
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
					let err, fn, respcmd;

					err = SystemInterface.parseCommand (cmdInv);
					if (SystemInterface.isError (err)) {
						Log.debug (`Discard WebSocket command; address=${clientaddress} cmdInv=${JSON.stringify (cmdInv)} err=${err}`);
						return;
					}

					if ((App.AUTHORIZE_SECRET != "") && (cmdInv.command == SystemInterface.CommandId.Authorize)) {
						respcmd = this.accessControl.authorize (cmdInv);
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

					fn = this.linkCommandHandlerMap[cmdInv.commandType];
					if (typeof fn == "function") {
						if (App.AUTHORIZE_SECRET != "") {
							if (! this.accessControl.isCommandAuthorized (cmdInv)) {
								Log.debug (`Discard WebSocket command (unauthorized); address=${clientaddress}`);
								return;
							}
						}

						fn (client, cmdInv);
					}
				});

				if (App.AUTHORIZE_SECRET != "") {
					client.emit (SystemInterface.Constant.WebSocketEvent, this.createCommand ("AuthorizationRequired", SystemInterface.Constant.DefaultCommandType));
				}
				else {
					client.emit (SystemInterface.Constant.WebSocketEvent, this.createCommand ("LinkSuccess", SystemInterface.Constant.DefaultCommandType));
				}
			};
		}));
	}

	// Return a promise that starts the secondary HTTP server if it isn't already running
	startSecondaryHttpServer () {
		return (new Promise ((resolve, reject) => {
			let http, listenError, listenComplete;

			if (this.httpServer2 != null) {
				resolve ();
				return;
			}
			http = Http.createServer ((request, response) => {
				this.handleSecondaryServerRequest (request, response);
			});
			this.httpServer2 = http;

			setTimeout (() => {
				http.on ("error", listenError);
				http.listen (App.TCP_PORT2, null, 1024, listenComplete);
			}, 0);

			listenError = (err) => {
				http.removeListener ("error", listenError);
				reject (Error (err));
			};

			listenComplete = () => {
				let address;

				http.removeListener ("error", listenError);
				address = http.address ();
				if (typeof address.port != "number") {
					reject ("Internal error: failed to read listen port from HTTP server");
					return;
				}

				this.httpServerPort2 = address.port;
				Log.debug (`HTTP-2 listening; address=${this.urlHostname}:${this.httpServerPort2}`);
				http.on ("error", (err) => {
					Log.err (`HTTP-2 error; err=${err}`);
				});

				http.on ("close", () => {
					if (this.httpServer2 == http) {
						this.httpServer2 = null;
					}
				});

				resolve ();
			};
		}));
	}

	// Start all servers and invoke startCompleteCallback (err) when complete. If startCompleteCallback is not provided, instead return a promise that resolves if the operation succeeds or rejects if it doesn't.
	startAllServers (startCompleteCallback) {
		let execute = (executeCallback) => {
			let startServer, state;

			if (! this.isEnabled) {
				process.nextTick (() => {
					executeCallback ("Agent is not enabled for operation");
				});
				return;
			}

			for (let server of this.serverList) {
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
			for (let server of this.serverList) {
				server.configure (state[server.getAgentConfigurationKey ()]);
				if (! server.isConfigured) {
					process.nextTick (() => {
						executeCallback (`${server.name} is not configured`);
					});
					return;
				}
			}

			startServer = (item, callback) => {
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
		let stopServersComplete, writeStateComplete, stopHttp1Complete, stopHttp2Complete;

		this.accessControl.stop ();
		this.taskGroup.stop ();
		this.intentGroup.stop ();
		this.agentStopEventEmitter.emit (STOP_EVENT);

		setTimeout (() => {
			this.stopAllServers (stopServersComplete);
		}, 0);
		stopServersComplete = () => {
			if (! this.isStarted) {
				writeStateComplete ();
			}
			else {
				this.intentGroup.writeState (writeStateComplete);
			}
		};
		writeStateComplete = () => {
			if (this.httpServer1 == null) {
				stopHttp1Complete ();
			}
			else {
				this.httpServer1.close (stopHttp1Complete);
			}
		};
		stopHttp1Complete = () => {
			if (this.httpServer2 == null) {
				stopHttp2Complete ();
			}
			else {
				this.httpServer2.close (stopHttp2Complete);
			}
		};
		stopHttp2Complete = () => {
			stopCallback ();
		};
	}

	// Stop all servers and invoke endCallback when complete
	stopAllServers (endCallback) {
		let stopNextServer, stopComplete, serverindex;

		stopNextServer = () => {
			if (serverindex >= this.serverList.length) {
				endCallback ();
				return;
			}

			this.serverList[serverindex].stop (stopComplete);
		};

		stopComplete = () => {
			++serverindex;
			stopNextServer ();
		};

		serverindex = 0;
		stopNextServer ();
	}

	// Reset the urlHostname value as appropriate for configured values and detected interfaces
	resetUrlHostname () {
		let interfaces, addresses, ip, urlhostname;

		if (App.URL_HOSTNAME != null) {
			this.urlHostname = App.URL_HOSTNAME;
			return;
		}

		urlhostname = "";
		interfaces = Os.networkInterfaces ();
		for (let i in interfaces) {
			addresses = interfaces[i];
			for (let addr of addresses) {
				if (addr.internal) {
					continue;
				}
				if (addr.family != "IPv4") {
					// TODO: Possibly support IPv6 interface addresses
					continue;
				}

				ip = new Ipv4Address (addr.address);
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
			this.urlHostname = Os.hostname ();
		}
	}

	// Return the server object with the specified name, or null if no such server was found
	getServer (serverName) {
		for (let server of this.serverList) {
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
		let path, url, address, body, q, execute;

		address = request.socket.remoteAddress + ":" + request.socket.remotePort;
		path = null;
		url = Url.parse (request.url);
		if (url != null) {
			path = url.pathname;
		}
		if (path == null) {
			this.endRequest (request, response, 404, "Not found");
			return;
		}

		execute = (body) => {
			let cmdinv, fn, responsedata, buffer;
			fn = this.mainRequestHandlerMap[path];
			if (fn != null) {
				cmdinv = SystemInterface.parseCommand (body);
				if (SystemInterface.isError (cmdinv)) {
					cmdinv = { };
				}
				fn (cmdinv, request, response);
				return;
			}

			cmdinv = SystemInterface.parseCommand (body);
			if (SystemInterface.isError (cmdinv)) {
				this.endRequest (request, response, 400, "Bad request");
				return;
			}

			fn = this.invokeRequestHandlerMap[cmdinv.commandType + ":" + path];
			if (fn != null) {
				if ((App.AUTHORIZE_SECRET != "") && (cmdinv.command != SystemInterface.CommandId.Authorize)) {
					if (! this.accessControl.isCommandAuthorized (cmdinv)) {
						this.endRequest (request, response, 401, "Unauthorized");
						return;
					}
				}

				responsedata = fn (cmdinv);
				if (responsedata == null) {
					this.endRequest (request, response, 200, "");
					return;
				}

				if (typeof responsedata != "object") {
					this.endRequest (request, response, 500, "Internal server error");
					return;
				}

				buffer = Buffer.from (JSON.stringify (responsedata), "UTF-8");
				this.endRequest (request, response, 200, buffer);
				return;
			}
			this.endRequest (request, response, 404, "Not found");
		};

		if (request.method == "GET") {
			q = QueryString.parse (url.query);
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
			this.endRequest (request, response, 405, "Method not allowed");
		}
	}

	// Handle a request received by the secondary HTTP server
	handleSecondaryServerRequest (request, response) {
		let path, url, address, body, q, execute;

		address = request.socket.remoteAddress + ":" + request.socket.remotePort;
		path = null;
		url = Url.parse (request.url);
		if (url != null) {
			path = url.pathname;
		}
		if (path == null) {
			this.endRequest (request, response, 404, "Not found");
			return;
		}

		execute = (body) => {
			let writeFile, cmdinv, fn, dirname, matches, filepath;
			fn = this.secondaryRequestHandlerMap[path];
			if (fn != null) {
				cmdinv = SystemInterface.parseCommand (body);
				if (SystemInterface.isError (cmdinv)) {
					cmdinv = { };
				}
				fn (cmdinv, request, response);
				return;
			}

			dirname = path;
			matches = dirname.match (/^([/][^/]*)[/].*$/);
			if (matches != null) {
				dirname = matches[1];
			}

			dirname = this.webrootMap[dirname];
			if (typeof dirname != "string") {
				this.endRequest (request, response, 404, "Not found");
				return;
			}
			filepath = Path.join (App.WEBROOT_DIRECTORY, dirname);
			if (path.length >= dirname.length) {
				filepath = Path.join (filepath, Path.normalize (path.substring (dirname.length)));
			}

			Fs.stat (filepath, (err, stats) => {
				if (err != null) {
					this.endRequest (request, response, 404, "Not found");
					return;
				}
				if (stats.isFile ()) {
					writeFile (filepath, stats);
					return;
				}
				if (! stats.isDirectory ()) {
					this.endRequest (request, response, 404, "Not found");
					return;
				}
				filepath = Path.normalize (Path.join (filepath, WEBROOT_INDEX_FILENAME));
				Fs.stat (filepath, (err, stats) => {
					if (err != null) {
						this.endRequest (request, response, 404, "Not found");
						return;
					}
					if (! stats.isFile ()) {
						this.endRequest (request, response, 404, "Not found");
						return;
					}

					writeFile (filepath, stats);
				});
			});

			writeFile = (writeFilePath, fileStats) => {
				let stream, isopen, contenttype;

				contenttype = this.webrootContentTypeMap[Path.extname (writeFilePath)];
				if (typeof contenttype != "string") {
					contenttype = "application/octet-stream";
				}

				isopen = false;
				stream = Fs.createReadStream (writeFilePath, { });
				stream.on ("error", (err) => {
					Log.err (`Failed to read webroot file; clientAddress=${address} path=${writeFilePath} err=${err}`);
					if (! isopen) {
						response.statusCode = 500;
						response.end ();
					}
				});

				stream.on ("open", () => {
					if (isopen) {
						return;
					}

					isopen = true;
					response.statusCode = 200;
					response.setHeader ("Content-Type", contenttype);
					response.setHeader ("Content-Length", fileStats.size);
					stream.pipe (response);
					stream.on ("finish", () => {
						response.end ();
					});

					response.socket.setMaxListeners (0);
					response.socket.once ("error", (err) => {
						stream.close ();
					});
				});
			};
		};

		if (request.method == "GET") {
			q = QueryString.parse (url.query);
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
			this.endRequest (request, response, 405, "Method not allowed");
		}
	}

	// End an HTTP request
	endRequest (request, response, code, data) {
		response.statusCode = code;
		response.setHeader ("Access-Control-Allow-Origin", "*");
		response.setHeader ("Content-Length", data.length);
		if (data.length > 0) {
			response.write (data);
		}
		response.end ();
	}

	// Set a request handler for the specified path. If a request with this path is received on the main HTTP server, the handler function is invoked with "request" and "response" objects.
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
			this.authorizePath = "/" + this.authorizePath;
		}
		this.addInvokeRequestHandler (this.authorizePath, SystemInterface.Constant.DefaultCommandType, (cmdInv) => {
			switch (cmdInv.command) {
				case SystemInterface.CommandId.Authorize: {
					return (this.accessControl.authorize (cmdInv));
				}
			}
		});
	}

	// Set an invocation handler for the specified path and command type. If a matching request is received, the handler function is invoked with a "cmdInv" parameter (a SystemInterface command invocation object). The handler function is expected to return a command invocation object to be included in a response to the caller, or null if no such invocation is needed.
	addInvokeRequestHandler (path, commandType, handler) {
		this.invokeRequestHandlerMap[commandType + ":" + path] = handler;
	}

	// Remove a previously added invocation handler
	removeInvokeRequestHandler (path, commandType) {
		delete (this.invokeRequestHandlerMap[commandType + ":" + path]);
	}

	// Set a request handler for the specified path. If a request with this path is received on the secondary HTTP server, the handler function is invoked with "request" and "response" objects.
	addSecondaryRequestHandler (urlPath, handler) {
		if (urlPath.indexOf ("/") != 0) {
			urlPath = "/" + urlPath;
		}
		this.secondaryRequestHandlerMap[urlPath] = handler;
		if (this.isStarted && (this.httpServer2 == null)) {
			this.startSecondaryHttpServer ().then (() => { });
		}
	}

	// Set a webroot handler for the specified URL path and file path relative to the application webroot directory. If a request with a base path matching this URL path is received on the secondary HTTP server, it is handled by reading a webroot file.
	addWebroot (urlPath, filePath) {
		if (urlPath.indexOf ("/") != 0) {
			urlPath = "/" + urlPath;
		}
		if (typeof filePath != "string") {
			filePath = urlPath;
		}
		this.webrootMap[urlPath] = filePath;
		if (this.isStarted && (this.httpServer2 == null)) {
			this.startSecondaryHttpServer ().then (() => { });
		}
	}

	// Set a handler for the specified command type. If a matching request is received, the handler function is invoked with "client" (a socket.io client) and "cmdInv" (a SystemInterface command invocation object) parameters.
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
			}, App.STORE_RUN_PERIOD * 1000, App.STORE_RUN_PERIOD * 1000);
		}

		if (typeof runCallback == "function") {
			if ((this.dataStore != null) && this.dataStore.isRunning) {
				process.nextTick (runCallback);
			}
			else {
				this.runDataStoreEventEmitter.once (START_EVENT, runCallback);
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

		this.dataStore = new DataStore (App.MONGOD_PATH, this.dataPath + "/records", App.STORE_PORT);
		this.dataStore.run ().then (() => {
			this.runDataStoreEventEmitter.emit (START_EVENT);
			runCallback ();
		}).catch ((err) => {
			Log.err (`Failed to start data store process; runPath="${App.MONGOD_PATH}" err=${err}`);
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
			let ds;

			ds = this.dataStore;
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
			let path, statComplete, createDirectoryComplete;

			if (process.platform != "linux") {
				this.memoryFilePath = "";
				resolve ();
				return;
			}

			setTimeout (() => {
				// User-specific tmpfs directory, available on Raspbian and other Linux systems
				path = Path.join (Path.sep, "run", "user", "" + process.getuid ());
				Fs.stat (path, statComplete);
			}, 0);
			statComplete = (err, stats) => {
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

			createDirectoryComplete = (err) => {
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
		for (let i in fields) {
			this.runState[i] = fields[i];
		}

		if (typeof endCallback != "function") {
			endCallback = () => { };
		}
		FsUtil.writeStateFile (this.runStatePath, this.runState, endCallback);
	}

	// Execute actions needed to maintain the datagram socket and invoke endCallback when complete
	updateDatagramSocket (endCallback) {
		let addrmap, interfaces, addresses, item, ip, ischanged, createSocket;

		addrmap = { };
		interfaces = Os.networkInterfaces ();
		for (let i in interfaces) {
			addresses = interfaces[i];
			for (let addr of addresses) {
				if (addr.internal) {
					continue;
				}
				if (addr.family != "IPv4") {
					// TODO: Possibly support IPv6 interface addresses
					continue;
				}

				ip = new Ipv4Address (addr.address);
				ip.setNetmask (addr.netmask);
				addrmap[i] = ip.getBroadcastAddress ();
				break;
			}
		}

		if (Object.keys (addrmap).length <= 0) {
			if (Object.keys (this.datagramBroadcastAddressMap).length > 0) {
				this.datagramBroadcastAddressMap = { };
			}
			if (this.datagramSocket != null) {
				Log.debug ("Close datagram socket (no broadcast addresses available)");
				this.isBroadcastReady = false;
				this.datagramSocket.close ();
				this.datagramSocket = null;
			}
		}
		else {
			ischanged = false;
			if (Object.keys (addrmap).length != Object.keys (this.datagramBroadcastAddressMap).length) {
				ischanged = true;
			}
			else {
				for (let i in addrmap) {
					if (addrmap[i] != this.datagramBroadcastAddressMap[i]) {
						ischanged = true;
						break;
					}
				}
			}

			if (ischanged) {
				if (this.datagramSocket != null) {
					this.isBroadcastReady = false;
					this.datagramSocket.close ();
					this.datagramSocket = null;
				}
				this.datagramBroadcastAddressMap = addrmap;
			}

			if (this.datagramSocket == null) {
				createSocket = () => {
					let socket;

					socket = Dgram.createSocket ("udp4");
					socket.on ("error", (err) => {
						Log.err (`Datagram socket error; err=${err}`);
						socket.close ();
						this.isBroadcastReady = false;
						this.datagramSocket = null;
					});
					socket.on ("listening", () => {
						let address, port;

						try {
							socket.setBroadcast (true);
						}
						catch (e) {
							this.isBroadcastReady = false;
							this.datagramSocket = null;
							Log.warn (`Failed to enable broadcast socket, network functions may be unavailable; err=${err}`);
							return;
						}
						address = socket.address ();
						if (address != null) {
							port = address.port;
						}
						if (typeof port != "number") {
							this.isBroadcastReady = false;
							this.datagramSocket = null;
							Log.warn ("Failed to read port from datagram socket, network functions may be unavailable");
							return;
						}
						Log.debug (`Datagram socket listening; port=${port}`);
						this.datagramSocketPort = port;
						this.isBroadcastReady = true;
					});
					socket.on ("message", (msg, rinfo) => {
						this.handleDatagramMessage (msg);
					});

					socket.bind (App.UDP_PORT);
					return (socket);
				};
				this.datagramSocket = createSocket ();
			}
		}

		process.nextTick (endCallback);
	}

	// Execute actions appropriate for a received datagram message
	handleDatagramMessage (msg) {
		let cmd;

		cmd = SystemInterface.parseCommand (msg.toString ());
		if (SystemInterface.isError (cmd)) {
			return;
		}

		switch (cmd.command) {
			case SystemInterface.CommandId.ReportStatus: {
				let statuscmd, desturl, url;

				desturl = cmd.params.destination;
				url = Url.parse (cmd.params.destination);
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
				let contactcmd, desturl, url;

				desturl = cmd.params.destination;
				url = Url.parse (cmd.params.destination);
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
		let i, item;

		if (! this.isBroadcastReady) {
			return (false);
		}

		if (typeof message == "string") {
			message = Buffer.from (message);
		}
		for (i in this.datagramBroadcastAddressMap) {
			item = this.datagramBroadcastAddressMap[i];
			this.datagramSocket.send (message, 0, message.length, SystemInterface.Constant.DefaultUdpPort, item);
		}
		return (true);
	}

	// Send a message using an HTTP POST request and the provided string or Buffer value
	sendHttpPost (postUrl, message) {
		let url, postdata, req;

		url = postUrl;
		if (typeof url == "string") {
			url = Url.parse (url);
			if (url == null) {
				Log.debug (`Failed to send HTTP POST request; err=Invalid URL, ${postUrl}`);
				return;
			}
		}

		postdata = message;
		req = Http.request ({
			hostname: url.hostname,
			port: url.port,
			path: url.path,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Content-Length": postdata.length
			}
		}, requestComplete);
		req.on ("error", requestError);

		function requestComplete (response) {
		}

		function requestError (err) {
			Log.debug (`Error sending HTTP POST request; err=${err} postUrl=${postUrl}`);
		}

		req.write (postdata);
		req.end ();
	}

	// Return an object containing an AgentStatus command that reflects current state, or null if the command could not be created
	getStatus () {
		let cmd, params;

		if (! this.isBroadcastReady) {
			return (null);
		}

		params = {
			id: this.agentId,
			displayName: this.displayName,
			applicationName: this.applicationName,
			urlHostname: this.urlHostname,
			tcpPort1: this.httpServerPort1,
			tcpPort2: this.httpServerPort2,
			udpPort: this.datagramSocketPort,
			linkPath: this.linkPath,
			uptime: Log.getDurationString (new Date ().getTime () - this.startTime),
			version: App.VERSION,
			nodeVersion: process.version,
			platform: App.AGENT_PLATFORM,
			isEnabled: this.isEnabled,
			taskCount: this.taskGroup.getTaskCount (),
			runCount: this.taskGroup.getRunCount (),
			maxRunCount: this.taskGroup.maxRunCount
		};
		for (let server of this.serverList) {
			server.setStatus (params);
		}

		cmd = SystemInterface.createCommand (this.getCommandPrefix (), "AgentStatus", SystemInterface.Constant.DefaultCommandType, params);
		if (SystemInterface.isError (cmd)) {
			Log.err (`Failed to create agent status command; err=${cmd}`);
			return (null);
		}

		return (cmd);
	}

	// Return an object containing an AgentConfiguration command that reflects current state, or null if the command could not be created
	getConfiguration () {
		let params;

		params = { };
		for (let server of this.serverList) {
			server.getConfiguration (params);
		}
		params.isEnabled = this.isEnabled;
		params.displayName = this.displayName;

		return (this.createCommand ("AgentConfiguration", SystemInterface.Constant.DefaultCommandType, params));
	}

	// Return an object containing an AgentContact command that reflects current state, or null if the contact command could not be created. The generated command uses a default prefix with empty fields to yield a shorter message.
	getContact () {
		let params;

		params = {
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
		let uuid, id, chars;

		if (typeof idType != "number") {
			idType = 0;
		}
		if (idType < 0) {
			idType = 0;
		}
		if (idType > 0xFFFF) {
			idType = 0xFFFF;
		}

		id = new Date ().getTime ();
		id = Math.floor (id / 1000);
		id = id.toString (16);
		while (id.length < 12) {
			id = "0" + id;
		}
		uuid = id.substring (0, 8);
		uuid += "-" + id.substring (8, 12);

		id = idType.toString (16);
		while (id.length < 4) {
			id = "0" + id;
		}
		uuid += "-" + id;

		chars = [ '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f' ];
		id = "";
		while (id.length < 16) {
			id += chars[Math.floor (Math.random () * chars.length)];
		}
		uuid += "-" + id.substring (0, 4);
		uuid += "-" + id.substring (4, 16);

		return (uuid);
	}

	// Return the command type assigned to the specified UUID value, or -1 if no command type was found
	getUuidCommand (id) {
		let matches, cmd;

		matches = id.match (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-([0-9a-fA-F]{4})-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
		if (matches == null) {
			return (-1);
		}

		cmd = parseInt (matches[1], 16);
		if (isNaN (cmd)) {
			return (-1);
		}

		return (cmd);
	}

	// Return a SystemInterface command prefix object, suitable for use with the getCommandInvocation method
	getCommandPrefix (priority, startTime, duration) {
		let prefix;

		prefix = { };
		prefix[SystemInterface.Constant.CreateTimePrefixField] = new Date ().getTime ();
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
		let hash;

		hash = Crypto.createHash (SystemInterface.Constant.AuthorizationHashAlgorithm);
		SystemInterface.setCommandAuthorization (cmdInv, authorizeSecret, authorizeToken,
			(data) => {
				hash.update (data);
			},
			() => {
				return (hash.digest ("hex"));
			}
		);
	}

	// Return an object containing a command with the default agent prefix and the provided parameters, or null if the command could not be validated, in which case an error log message is generated
	createCommand (commandName, commandType, commandParams, authorizeSecret, authorizeToken) {
		let cmd;

		cmd = SystemInterface.createCommand (this.getCommandPrefix (), commandName, commandType, commandParams);
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
		let execute = (executeCallback) => {
			let options, req, path, body, requestStarted, endRequest;

			if (SystemInterface.isError (cmdInv)) {
				if (executeCallback != null) {
					process.nextTick (() => {
						executeCallback ("Invalid command: " + cmdInv, url, null);
					});
				}
				return;
			}

			body = "";
			setTimeout (() => {
				path = invokePath;
				if (path.indexOf ("/") != 0) {
					path = "/" + path;
				}
				path += "?" + SystemInterface.Constant.UrlQueryParameter + "=" + encodeURIComponent (JSON.stringify (cmdInv));
				options = {
					method: "GET",
					hostname: urlHostname,
					port: tcpPort,
					path: path
				};
				if (App.ENABLE_HTTPS) {
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

			requestStarted = (res) => {
				if (res.statusCode != 200) {
					endRequest ("Non-success response code " + res.statusCode, null);
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

			endRequest = (err, data) => {
				let responsecmd;

				if (executeCallback != null) {
					responsecmd = null;
					if (err == null) {
						responsecmd = SystemInterface.parseCommand (data);
						if (SystemInterface.isError (responsecmd)) {
							err = "Response for \"" + cmdInv.commandName + "\" contained invalid command invocation, " + responsecmd;
							responsecmd = null;
						}
					}

					if ((err == null) && (typeof responseCommandId == "number")) {
						if (responsecmd.command != responseCommandId) {
							err = "Response for \"" + cmdInv.commandName + "\" contained invalid command type " + responsecmd.command + ", expected " + responseCommandId;
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

	// Execute an HTTP GET operation for the provided URL and save response data into the specified path. Invokes endCallback (err, destFilename) when complete. If endCallback is not provided, instead return a Promise that executes the operation.
	fetchUrlFile (url, targetDirectory, targetFilename, endCallback) {
		let execute = (executeCallback) => {
			let httpreq, httpres, stream, tempfilename, destfilename;

			destfilename = null;
			Log.debug2 (`fetchUrlFile; url=${url} targetDirectory=${targetDirectory} targetFilename=${targetFilename}`);
			Fs.stat (targetDirectory, statTargetDirectoryComplete);
			function statTargetDirectoryComplete (err, stats) {
				if (err != null) {
					executeCallback (err, null);
					return;
				}

				if (! stats.isDirectory ()) {
					executeCallback (targetDirectory + " exists but is not a directory", null);
					return;
				}

				assignTempFilePath ();
			}

			function assignTempFilePath () {
				tempfilename = targetDirectory + "/urldata_" + new Date ().getTime () + "_" + App.systemAgent.getRandomString (16);
				Fs.stat (tempfilename, statTempFilePathComplete);
			}

			function statTempFilePathComplete (err, stats) {
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
			}

			function fileError (err) {
				stream.close ();
				endRequest (err);
			}

			function fileOpened () {
				try {
					httpreq = Http.get (url, requestStarted);
				}
				catch (e) {
					endRequest (e);
					return;
				}
				httpreq.on ("error", function (err) {
					endRequest (err);
				});
			}

			function requestStarted (res) {
				let matchresult;

				httpres = res;
				if (httpres.statusCode != 200) {
					endRequest ("Non-success response code " + httpres.statusCode);
					return;
				}

				if (typeof targetFilename == "string") {
					destfilename = Path.join (targetDirectory, targetFilename);
				}

				if (destfilename == null) {
					val = httpres.headers["content-disposition"];
					if (typeof val == "string") {
						matchresult = val.match (/^attachment; filename=(.*)/);
						if (matchresult != null) {
							destfilename = targetDirectory + "/" + matchresult[1];
						}
					}
				}
				httpres.once ("error", function (err) {
					endRequest (err);
				});
				httpres.on ("data", function (data) {
					stream.write (data);
				});
				httpres.on ("end", responseComplete);
			}

			function responseComplete () {
				stream.end ();
				stream.once ("finish", streamFinished)
			}

			function streamFinished () {
				endRequest (null);
			}

			function endRequest (err) {
				if (err != null) {
					Fs.unlink (tempfilename, function () { });
					executeCallback (err, null);
					return;
				}

				if (destfilename == null) {
					// TODO: Rename the target file by parsing the last section of the URL path
					executeCallback (null, tempfilename);
					return;
				}

				Fs.rename (tempfilename, destfilename, renameComplete);
			}

			function renameComplete (err) {
				if (err != null) {
					Fs.unlink (tempfilename, function () { });
					executeCallback (err, null);
					return;
				}

				executeCallback (null, destfilename);
			}
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
	fetchUrlData (url, endCallback) {
		let execute = (executeCallback) => {
			let httpreq, httpres, urldata;

			urldata = "";
			Log.debug2 (`fetchUrlData; url=${url}`);
			try {
				httpreq = Http.get (url, requestStarted);
			}
			catch (e) {
				endRequest (e);
				return;
			}
			httpreq.on ("error", function (err) {
				endRequest (err);
			});

			function requestStarted (res) {
				httpres = res;
				if (httpres.statusCode != 200) {
					endRequest ("Non-success response code " + httpres.statusCode);
					return;
				}
				httpres.once ("error", function (err) {
					endRequest (err);
				});
				httpres.on ("data", function (data) {
					urldata += data.toString ();
				});
				httpres.on ("end", responseComplete);
			}

			function responseComplete () {
				endRequest (null);
			}

			function endRequest (err) {
				if (err != null) {
					executeCallback (err, null);
					return;
				}

				executeCallback (null, urldata);
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
		let s, chars;

		chars = [ "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9" ];
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

		delay = App.HEARTBEAT_PERIOD;
		delay += Math.floor (Math.random () * 128);

		return (delay);
	}

	// Return a newly created ExecProcess object that launches ffmpeg. workingPath defaults to the application data directory if empty.
	createFfmpegProcess (runArgs, workingPath, processData, processEnded) {
		let runpath, env;

		runpath = App.FFMPEG_PATH;
		env = { };
		if (runpath == "") {
			if (process.platform == "win32") {
				runpath = "ffmpeg/bin/ffmpeg.exe";
			}
			else if (process.platform == "linux") {
				runpath = "ffmpeg/ffmpeg";
				env.LD_LIBRARY_PATH = App.BIN_DIRECTORY + "/ffmpeg/lib";
			}
			else {
				runpath = "ffmpeg";
			}
		}

		return (new ExecProcess (runpath, runArgs, env, workingPath, processData, processEnded));
	}

	// Return a newly created ExecProcess object that launches ffprobe. workingPath defaults to the application data directory if empty.
	createFfprobeProcess (runArgs, workingPath, processData, processEnded) {
		let runpath, env;

		runpath = App.FFMPEG_PATH;
		env = { };
		if (runpath == "") {
			if (process.platform == "win32") {
				runpath = "ffmpeg/bin/ffprobe.exe";
			}
			else if (process.platform == "linux") {
				runpath = "ffmpeg/ffprobe";
				env.LD_LIBRARY_PATH = App.BIN_DIRECTORY + "/ffmpeg/lib";
			}
			else {
				runpath = "ffprobe";
			}
		}

		return (new ExecProcess (runpath, runArgs, env, workingPath, processData, processEnded));
	}

	createOpensslProcess (runArgs, workingPath, processData, processEnded) {
		let runpath, env;

		runpath = App.OPENSSL_PATH;
		env = { };
		if (runpath == "") {
			if (process.platform == "win32") {
				runpath = "openssl.exe";
			}
			else if (process.platform == "linux") {
				runpath = "openssl/bin/openssl";
				env.LD_LIBRARY_PATH = App.BIN_DIRECTORY + "/openssl/lib";
			}
			else {
				runpath = "openssl";
			}
		}

		return (new ExecProcess (runpath, runArgs, env, workingPath, processData, processEnded));
	}
}

module.exports = SystemAgent;
