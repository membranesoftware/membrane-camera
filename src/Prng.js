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
// Class that generates pseudo-random values

"use strict";

const Crypto = require ("crypto");

const KeyRepeatCount = 64;
const DefaultRandomChars = "0123456789abcdefghijklmnopqrstuvwxyz";
const UuidChars = "0123456789abcdef";

class Prng {
	constructor (randomChars) {
		let chars, numbers, buf, pos;

		if (typeof randomChars != "string") {
			randomChars = DefaultRandomChars;
		}

		this.stringKey = "";
		for (let i = 0; i < KeyRepeatCount; ++i) {
			chars = randomChars;
			while (chars.length > 0) {
				buf = Crypto.randomBytes (4);
				pos = Math.floor ((buf.readUInt32BE () / 0x100000000) * chars.length);
				this.stringKey += chars.charAt (pos);
				chars = chars.substring (0, pos) + chars.substring (pos + 1);
			}
		}

		this.numberKey = [ ];
		for (let i = 0; i < KeyRepeatCount; ++i) {
			numbers = [ ];
			for (let j = 0; j <= 0xFF; ++j) {
				numbers.push (j);
			}
			while (numbers.length > 0) {
				buf = Crypto.randomBytes (4);
				pos = Math.floor ((buf.readUInt32BE () / 0x100000000) * numbers.length);
				this.numberKey.push (numbers[pos]);
				numbers.splice (pos, 1);
			}
		}
	}

	// Return a randomly selected integer within the provided inclusive range
	getRandomInteger (min, max) {
		min = Math.floor (min);
		max = Math.floor (max);
		const diff = max - min;
		if (diff <= 0) {
			return (Math.floor (min));
		}

		const bytes = [ ];
		bytes.push (this.numberKey[Math.floor (Math.random () * this.numberKey.length)]);
		bytes.push (this.numberKey[Math.floor (Math.random () * this.numberKey.length)]);
		bytes.push (this.numberKey[Math.floor (Math.random () * this.numberKey.length)]);
		bytes.push (this.numberKey[Math.floor (Math.random () * this.numberKey.length)]);
		const buf = Buffer.from (bytes);
		return (Math.floor (min + ((buf.readUInt32BE () / 0x100000000) * (diff + 1))));
	}

	// Return a randomly selected string of the specified length
	getRandomString (stringLength) {
		let s;

		if ((typeof stringLength != "number") || (stringLength <= 0)) {
			return ("");
		}
		s = "";
		for (let i = 0; i < stringLength; ++i) {
			s += this.stringKey.charAt (Math.floor (Math.random () * this.stringKey.length));
		}
		return (s);
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

		id = "";
		while (id.length < 16) {
			id += UuidChars[this.getRandomInteger (0, UuidChars.length - 1)];
		}
		uuid += `-${id.substring (0, 4)}`;
		uuid += `-${id.substring (4, 16)}`;

		return (uuid);
	}
}
module.exports = Prng;
