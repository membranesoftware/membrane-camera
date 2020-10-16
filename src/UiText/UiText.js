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
// Class that holds strings for use in UI text

"use strict";

const App = global.App || { };
const Path = require ("path");
const Log = require (Path.join (App.SOURCE_DIRECTORY, "Log"));

const DefaultLanguage = "en";

class UiText {
	constructor (language) {
		this.strings = { };
		this.load (language);
	}

	// Load text strings of the desired language, or the default language if not specified
	load (language) {
		let strings;

		if ((typeof language == "string") && (language != "")) {
			try {
				strings = require (Path.join (App.SOURCE_DIRECTORY, "UiText", `${language}.js`));
			}
			catch (err) {
				Log.warn (`Failed to load text strings; language=${language} err=${err}`);
				strings = null;
			}

			if (strings != null) {
				Log.debug (`Loaded text strings; language=${language}`);
				this.strings = strings;
				return;
			}
		}

		language = DefaultLanguage;
		try {
			strings = require (Path.join (App.SOURCE_DIRECTORY, "UiText", `${language}.js`));
		}
		catch (err) {
			Log.warn (`Failed to load text strings; language=${language} err=${err}`);
			strings = null;
		}
		if (strings != null) {
			Log.debug (`Loaded text strings; language=${language}`);
			this.strings = strings;
		}
	}

	// Return the text string matching the specified key, or an empty string if no such string was found
	getText (key) {
		const s = this.strings[key];
		return ((typeof s == "string") ? s : "");
	}
}
module.exports = UiText;
