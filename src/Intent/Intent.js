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
// Intent subclasses and utility functions

"use strict";

const App = global.App || { };
const Path = require ("path");
const Result = require (Path.join (App.SOURCE_DIRECTORY, "Result"));
const SystemInterface = require (Path.join (App.SOURCE_DIRECTORY, "SystemInterface"));
const IntentTypes = require ("./types");

exports.IntentTypes = IntentTypes;

// Return a newly created intent of the specified type name and configure it with the provided object. Returns null if the intent could not be created, indicating that the type name was not found or the configuration was not valid.
exports.createIntent = (typeName, configureParams) => {
	const type = IntentTypes[typeName];
	if (type == null) {
		return (null);
	}

	const intent = new type ();
	if ((typeof configureParams != "object") || (configureParams == null)) {
		configureParams = { };
	}
	if (intent.configure (configureParams) != Result.Success) {
		return (null);
	}

	return (intent);
};

// Return a newly created intent, as constructed with the provided command, or null if the intent could not be created.
exports.createIntentFromCommand = (command) => {
	const cmd = SystemInterface.parseCommand (command);
	if (SystemInterface.isError (cmd)) {
		return (null);
	}

	for (const type of Object.values (IntentTypes)) {
		const intent = new type ();
		if (intent.configureFromCommand (cmd) == Result.Success) {
			return (intent);
		}
	}
	return (null);
};
