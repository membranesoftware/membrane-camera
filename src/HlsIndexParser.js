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
// Parser for HLS index data

const App = global.App || { };
const Log = require (App.SOURCE_DIRECTORY + "/Log");

// Return an object containing records parsed from the provided index data, or null if the data could not be parsed
function parse (indexData) {
	var data, lines, i, line, m, lastduration, pos, val;

	if (typeof indexData != "string") {
		return (null);
	}

	data = {
		segmentCount: 0,
		segmentFilenames: [ ],
		segmentLengths: [ ],
		segmentPositions: [ ],
		hlsTargetDuration: 0
	};
	lastduration = null;
	pos = 0;
	lines = indexData.split ("\n");
	for (i = 0; i < lines.length; ++i) {
		line = lines[i];

		m = line.match (/^#EXTINF:([0-9\.]+)/);
		if (m != null) {
			lastduration = parseFloat (m[1]);
			if (isNaN (lastduration)) {
				lastduration = null;
			}
			continue;
		}

		m = line.match (/^(.+)\.ts/);
		if (m != null) {
			if (lastduration !== null) {
				++(data.segmentCount);
				data.segmentFilenames.push (line);
				data.segmentLengths.push (lastduration);
				data.segmentPositions.push (parseFloat (pos.toFixed (5)));
				pos += lastduration;
				lastduration = null;
			}
			continue;
		}

		m = line.match (/^#EXT-X-TARGETDURATION:([0-9]+)/);
		if (m != null) {
			val = parseInt (m[1], 10);
			if (! isNaN (val)) {
				data.hlsTargetDuration = val;
			}
			continue;
		}
	}

	if (data.segmentCount <= 0) {
		return (null);
	}

	return (data);
}
exports.parse = parse;
