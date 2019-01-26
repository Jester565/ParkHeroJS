var profanities = require('profanities');

String.prototype.replaceAt=function(index, replacement) {
    return this.substr(0, index) + replacement+ this.substr(index + 1);
};

var profanityExceptions = {
	"mick": true,
	"nig": true
};

var vowels = {
	'a': true,
	'e': true, 
	'i': true, 
	'o': true, 
	'u': true
};
var numberToLetterMap = {
	'0': 'o',
	'1': 'i',
	'3': 'e',
	'5': 's',
	'6': 'b',
	'9': 'p'
};

function toProfanityFormat(str, maxVowels, combineSubsequent = false) {
	var filteredStr = str;
	//Convert vowels to same character
	//Combine successive vowels
	var maxVowelCount = 0;
	var vowelCount = 0;
	var i = 0;
	for (var i = 0; i < filteredStr.length; i++) {
		var c = filteredStr[i];
		//Map numbers to the letters they look like
		var mappedLetter = numberToLetterMap[c];
		if (mappedLetter != null) {
			filteredStr = filteredStr.replaceAt(i, mappedLetter);
			c = mappedLetter;
		}
		if (vowels[c] != null) {
			vowelCount++;
			//delete successive vowels
			if (vowelCount > maxVowels) {
				filteredStr = filteredStr.replaceAt(i, '');
				i--;
			}
		} else {
			//delete successive characters
			if (combineSubsequent && i > 0 && c == filteredStr[i - 1]) {
				filteredStr = filteredStr.replaceAt(i, '');
				i--;
			}
			if (vowelCount > maxVowelCount) {
				maxVowelCount = vowelCount;
			}
			vowelCount = 0;
		}
	}
	return {
		"str": filteredStr,
		"maxSuccessiveVowels": maxVowelCount
	};
}

function containsProfanity(name) {
	name = name.replace(/\s/g, '');
	name = name.toLowerCase();
	if( /[^a-zA-Z0-9]/.test(name)) {
		throw new Error("Only alpha-numeric is allowed");
	}
	var nameFormats = {};
	for (var profanity of profanities) {
		if (profanity.length > 2 && profanityExceptions[profanity] == null) {
			var formattedProfanityPair = toProfanityFormat(profanity, 5);
			var key = formattedProfanityPair.maxSuccessiveVowels.toString();
			if (nameFormats[key] == null) {
				nameFormats[key] = [
					toProfanityFormat(name, formattedProfanityPair.maxSuccessiveVowels, true).str,
					toProfanityFormat(name, formattedProfanityPair.maxSuccessiveVowels).str
				];
			}
			for (var name of nameFormats[key]) {
				if (name.indexOf(formattedProfanityPair.str) >= 0) {
					return true;
				}
			}
		}
    }
    return false;
}

module.exports = {
    containsProfanity: containsProfanity
};