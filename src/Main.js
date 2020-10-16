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
// Main execution method

"use strict";

const App = require ("./App");
const Path = require ("path");
const Log = require (Path.join (App.SOURCE_DIRECTORY, "Log"));
const FsUtil = require (Path.join (App.SOURCE_DIRECTORY, "FsUtil"));
const SystemAgent = require (Path.join (App.SOURCE_DIRECTORY, "SystemAgent"));
const SystemInterface = require (Path.join (App.SOURCE_DIRECTORY, "SystemInterface"));
const UiText = require (Path.join (App.SOURCE_DIRECTORY, "UiText", "UiText"));

process.setMaxListeners (0);
process.on ("uncaughtException", (err) => {
	if (err == null) {
		err = new Error ();
	}
	Log.err (`Uncaught exception: ${err.toString ()}\nStack: ${err.stack}`);
	process.exit (1);
});
process.on ("unhandledRejection", (err) => {
	if (err == null) {
		err = new Error ();
	}
	Log.err (`Unhandled promise rejection: ${err.toString ()}\nStack: ${err.stack}`);
	process.exit (1);
});

let fields, skiploglevel;

// Parameter fields for use in reading the systemagent configuration
const configParams = [
	{
		name: "LogLevel",
		type: "string",
		flags: SystemInterface.ParamFlag.Required,
		description: "The log level that should be written by the server",
		defaultValue: "ERR"
	},
	{
		name: "Language",
		type: "string",
		flags: SystemInterface.ParamFlag.Required,
		description: "The language that should be used for server UI text, or an empty value to select the language based on environment settings",
		defaultValue: ""
	},
	{
		name: "UdpPort",
		type: "number",
		flags: SystemInterface.ParamFlag.Required | SystemInterface.ParamFlag.RangedNumber,
		rangeMin: 0,
		rangeMax: 65535,
		description: "The UDP port to use for receiving network commands. A zero value indicates that a port should be chosen at random.",
		defaultValue: 0
	},
	{
		name: "TcpPort1",
		type: "number",
		flags: SystemInterface.ParamFlag.Required | SystemInterface.ParamFlag.RangedNumber,
		rangeMin: 0,
		rangeMax: 65535,
		description: "The primary TCP port to use for receiving network commands. A zero value indicates that a port should be chosen at random.",
		defaultValue: SystemInterface.Constant.DefaultTcpPort1
	},
	{
		name: "TcpPort2",
		type: "number",
		flags: SystemInterface.ParamFlag.Required | SystemInterface.ParamFlag.RangedNumber,
		rangeMin: 0,
		rangeMax: 65535,
		description: "The secondary TCP port to use for receiving network commands. A zero value indicates that a port should be chosen at random.",
		defaultValue: SystemInterface.Constant.DefaultTcpPort2
	},
	{
		name: "LinkPath",
		type: "string",
		flags: SystemInterface.ParamFlag.Required,
		description: "The URL path to use for link client connections, or an empty string for a randomly generated path",
		defaultValue: ""
	},
	{
		name: "Https",
		type: "boolean",
		flags: SystemInterface.ParamFlag.Required,
		description: "A boolean value indicating if the agent's listening server should enable https",
		defaultValue: true
	},
	{
		name: "AuthorizeSecret",
		type: "string",
		flags: SystemInterface.ParamFlag.Required,
		description: "The string token that should be used to require authorization from remote clients, or an empty string to require no authorization",
		defaultValue: ""
	},
	{
		name: "AuthorizePath",
		type: "string",
		flags: SystemInterface.ParamFlag.Required,
		description: "The URL path to use for authorize requests",
		defaultValue: SystemInterface.Constant.DefaultAuthorizePath
	},
	{
		name: "AuthorizeSessionDuration",
		type: "number",
		flags: SystemInterface.ParamFlag.Required | SystemInterface.ParamFlag.GreaterThanZero,
		description: "The duration to apply when expiring idle authorization sessions, in seconds",
		defaultValue: 60
	},
	{
		name: "Hostname",
		type: "string",
		flags: SystemInterface.ParamFlag.Required | SystemInterface.ParamFlag.Hostname,
		description: "The hostname that should be associated with the systemagent instance. If empty, the system hostname is used.",
		defaultValue: ""
	},
	{
		name: "AgentEnabled",
		type: "boolean",
		flags: SystemInterface.ParamFlag.Required,
		description: "A boolean value indicating if the agent should be enabled by default",
		defaultValue: true
	},
	{
		name: "AgentDisplayName",
		type: "string",
		flags: SystemInterface.ParamFlag.Required,
		description: "The descriptive name that should be associated with the systemagent instance. If empty, the system hostname is used.",
		defaultValue: ""
	},
	{
		name: "ApplicationName",
		type: "string",
		flags: SystemInterface.ParamFlag.Required,
		description: "The name of the application bundle that was used to install the systemagent instance",
		defaultValue: "Membrane Server"
	},
	{
		name: "MaxTaskCount",
		type: "number",
		flags: SystemInterface.ParamFlag.Required | SystemInterface.ParamFlag.ZeroOrGreater,
		description: "The maximum count of simultaneous tasks the agent should run",
		defaultValue: 1
	},
	{
		name: "OpensslPath",
		type: "string",
		flags: SystemInterface.ParamFlag.Required,
		description: "The path for the openssl executable. An empty value specifies that the agent's included openssl binary should be used.",
		defaultValue: ""
	},
	{
		name: "MongodPath",
		type: "string",
		flags: SystemInterface.ParamFlag.Required,
		description: "The path for the mongod executable. An empty value specifies that the agent's included mongod binary should be used.",
		defaultValue: "/usr/bin/mongod"
	},
	{
		name: "StorePort",
		type: "number",
		flags: SystemInterface.ParamFlag.Required | SystemInterface.ParamFlag.RangedNumber,
		rangeMin: 1,
		rangeMax: 65535,
		description: "The TCP port to use for the data store listener",
		defaultValue: 27017
	},
	{
		name: "StoreDatabase",
		type: "string",
		flags: SystemInterface.ParamFlag.Required | SystemInterface.ParamFlag.NotEmpty,
		description: "The database name to use for the data store",
		defaultValue: "membrane"
	},
	{
		name: "StoreCollection",
		type: "string",
		flags: SystemInterface.ParamFlag.Required | SystemInterface.ParamFlag.NotEmpty,
		description: "The collection name to use for the data store",
		defaultValue: "records"
	},
	{
		name: "StoreRunPeriod",
		type: "number",
		flags: SystemInterface.ParamFlag.Required | SystemInterface.ParamFlag.GreaterThanZero,
		description: "The interval to use for periodically relaunching the data store process if it isn't running, in seconds",
		defaultValue: 60
	}
];

skiploglevel = false;
if (typeof process.env.LOG_LEVEL == "string") {
	if (Log.setLevelByName (process.env.LOG_LEVEL)) {
		skiploglevel = true;
	}
}
if (typeof process.env.LOG_CONSOLE == "string") {
	Log.setConsoleOutput (true);
}
if (typeof process.env.DATA_DIRECTORY == "string") {
	App.DATA_DIRECTORY = process.env.DATA_DIRECTORY;
}
if (typeof process.env.BIN_DIRECTORY == "string") {
	App.BIN_DIRECTORY = process.env.BIN_DIRECTORY;
}
if (typeof process.env.CONF_DIRECTORY == "string") {
	App.CONF_DIRECTORY = process.env.CONF_DIRECTORY;
}

fields = null;
const conf = FsUtil.readConfigKeyFile (App.CONFIG_FILE);
if (conf != null) {
	fields = SystemInterface.parseCommand (conf, configParams);
	if (SystemInterface.isError (fields)) {
		console.log (`Error in configuration file ${App.CONFIG_FILE}: ${fields}`);
		process.exit (1);
	}

	if (! skiploglevel) {
		if (! Log.setLevelByName (fields.LogLevel)) {
			console.log (`Error in configuration file ${App.CONFIG_FILE}: Invalid log level ${fields.LogLevel}, must be one of: ERROR, WARN, NOTICE, INFO, DEBUG, DEBUG1, DEBUG2, DEBUG3, DEBUG4`);
			process.exit (1);
		}
	}

	if (fields.Hostname != "") {
		App.UrlHostname = fields.Hostname;
	}
	if (fields.AgentDisplayName != "") {
		App.AgentDisplayName = fields.AgentDisplayName;
	}
	App.AgentApplicationName = fields.ApplicationName;
	App.AgentEnabled = fields.AgentEnabled;
	App.UdpPort = fields.UdpPort;
	App.TcpPort1 = fields.TcpPort1;
	App.TcpPort2 = fields.TcpPort2;
	App.LinkPath = fields.LinkPath;
	App.EnableHttps = fields.Https;
	App.AuthorizePath = fields.AuthorizePath;
	App.AuthorizeSecret = fields.AuthorizeSecret;
	App.AuthorizeSessionDuration = fields.AuthorizeSessionDuration * 1000;
	App.MaxTaskCount = fields.MaxTaskCount;
	App.OpensslPath = fields.OpensslPath;
	App.MongodPath = fields.MongodPath;
	App.StorePort = fields.StorePort;
	App.StoreDatabase = fields.StoreDatabase;
	App.StoreCollection = fields.StoreCollection;
	App.StoreRunPeriod = fields.StoreRunPeriod;
	App.Language = fields.Language;
}

// TODO: Check for an environment value specifying text language
App.uiText = new UiText (App.Language);

App.systemAgent = new SystemAgent ();
App.systemAgent.start ((err) => {
	if (err != null) {
		Log.err (`Failed to start Membrane Server; err=${err}`);
		process.exit (1);
	}

	Log.info (`${App.AgentApplicationName} started; version=${App.VERSION} agentId=${App.systemAgent.agentId}`);
	Log.notice (`${App.AgentApplicationName} ${App.uiText.getText ("AppStartMessage")}`);
});

process.on ("SIGINT", () => {
	Log.notice ("Caught SIGINT, exit");
	App.systemAgent.stop (() => {
		process.exit (0);
	});
});

process.on ("SIGTERM", () => {
	Log.notice ("Caught SIGTERM, exit");
	App.systemAgent.stop (() => {
		process.exit (0);
	});
});
