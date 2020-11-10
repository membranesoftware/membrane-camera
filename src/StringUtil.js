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
// Utility functions for manipulating strings

"use strict";

// Return the provided string with a capitalized first letter
exports.capitalized = (str) => {
	if (str.length <= 0) {
		return (str);
	}
	if (str.length == 1) {
		return (str.toUpperCase ());
	}
	return (str.substring (0, 1).toUpperCase () + str.substring (1));
};

// Return the hostname portion of an address string
exports.parseAddressHostname = (str) => {
	const pos = str.indexOf (":");
	return ((pos >= 0) ? str.substring (0, pos) : str);
};

// Return a number parsed from the port portion of an address string, or the specified default if no port was found
exports.parseAddressPort = (str, defaultPort) => {
	const matches = str.match (/.*?:([0-9]+)$/);
	if (! Array.isArray (matches)) {
		return (defaultPort);
	}
	const port = +matches[1];
	return ((! isNaN (port)) ? port : defaultPort);
};

// Return a formatted duration string generated from the provided number of milliseconds
exports.getDurationString = (ms) => {
	let duration, t, s;

	duration = "";
	t = ms;
	t /= 1000;
	if (t >= 86400) {
		duration += `${Math.floor (t / 86400)}d `;
		t %= 86400;
	}

	s = `${Math.floor (t / 3600)}`;
	if (s.length < 2) {
		s = `0${s}`;
	}
	duration += s;
	t %= 3600;

	s = `${Math.floor (t / 60)}`;
	if (s.length < 2) {
		s = `0${s}`;
	}
	duration += `:${s}`;
	t %= 60;

	s = `${Math.floor (t)}`;
	if (s.length < 2) {
		s = `0${s}`;
	}
	duration += `:${s}`;

	return (duration);
};

// Return a size string for the provided number of bytes
exports.getSizeString = (size) => {
	if (size <= 0) {
		return ("0B");
	}
	if (size >= (1024 * 1024 * 1024)) {
		const val = size / (1024 * 1024 * 1024);
		return (`${val.toFixed (2)}GB`);
	}
	if (size >= (1024 * 1024)) {
		const val = size / (1024 * 1024);
		return (`${val.toFixed (2)}MB`);
	}
	if (size >= 1024) {
		const val = size / 1024;
		return (`${val.toFixed (2)}kB`);
	}
	return (`${size}B`);
};
