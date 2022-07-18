/*
* Copyright 2019-2022 Membrane Software <author@membranesoftware.com> https://membranesoftware.com
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
// Intent subclasses and utility functions

"use strict";

const App = global.App || { };
const Path = require ("path");
const SystemInterface = require (Path.join (App.SOURCE_DIRECTORY, "SystemInterface"));
const IntentTypes = require ("./types");

exports.IntentTypes = IntentTypes;

// Return a newly created intent of the specified type name and configure it with the provided object
exports.createIntent = (typeName, configureParams) => {
	const type = IntentTypes[typeName];
	if (type == null) {
		throw Error (`Unknown intent type ${typeName}`);
	}

	const intent = new type ();
	intent.name = typeName;
	if ((typeof configureParams != "object") || (configureParams == null)) {
		configureParams = { };
	}
	intent.configure (configureParams);
	return (intent);
};

// Return a newly created intent, as constructed with the provided command
exports.createIntentFromCommand = (command) => {
	let intent;

	const cmd = SystemInterface.parseCommand (command);
	if (SystemInterface.isError (cmd)) {
		throw Error (`Invalid intent create command; err=${cmd}`);
	}

	for (const name of Object.keys (IntentTypes)) {
		try {
			intent = new IntentTypes[name] ();
			intent.name = name;
			intent.configureFromCommand (cmd);
		}
		catch (err) {
			intent = null;
		}
		if (intent != null) {
			return (intent);
		}
	}
	throw Error (`Invalid intent create command; err="Unknown command type ${cmd.command}"`);
};
