// ../../node_modules/.bun/fast-xml-parser@5.10.1/node_modules/fast-xml-parser/src/util.js
var nameStartChar = ":A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD";
var nameChar = nameStartChar + "\\-.\\d\\u00B7\\u0300-\\u036F\\u203F-\\u2040";
var nameRegexp = "[" + nameStartChar + "][" + nameChar + "]*";
var regexName = new RegExp("^" + nameRegexp + "$");
function getAllMatches(string, regex) {
  const matches = [];
  let match = regex.exec(string);
  while (match) {
    const allmatches = [];
    allmatches.startIndex = regex.lastIndex - match[0].length;
    const len = match.length;
    for (let index = 0;index < len; index++) {
      allmatches.push(match[index]);
    }
    matches.push(allmatches);
    match = regex.exec(string);
  }
  return matches;
}
var isName = function(string) {
  const match = regexName.exec(string);
  return !(match === null || typeof match === "undefined");
};
function isExist(v) {
  return typeof v !== "undefined";
}
var DANGEROUS_PROPERTY_NAMES = [
  "hasOwnProperty",
  "toString",
  "valueOf",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__"
];
var criticalProperties = ["__proto__", "constructor", "prototype"];

// ../../node_modules/.bun/fast-xml-parser@5.10.1/node_modules/fast-xml-parser/src/validator.js
var defaultOptions = {
  allowBooleanAttributes: false,
  unpairedTags: []
};
function validate(xmlData, options) {
  options = Object.assign({}, defaultOptions, options);
  const tags = [];
  let tagFound = false;
  let reachedRoot = false;
  if (xmlData[0] === "\uFEFF") {
    xmlData = xmlData.substr(1);
  }
  for (let i = 0;i < xmlData.length; i++) {
    if (xmlData[i] === "<" && xmlData[i + 1] === "?") {
      i += 2;
      i = readPI(xmlData, i);
      if (i.err)
        return i;
    } else if (xmlData[i] === "<") {
      let tagStartPos = i;
      i++;
      if (xmlData[i] === "!") {
        i = readCommentAndCDATA(xmlData, i);
        continue;
      } else {
        let closingTag = false;
        if (xmlData[i] === "/") {
          closingTag = true;
          i++;
        }
        let tagName = "";
        for (;i < xmlData.length && xmlData[i] !== ">" && xmlData[i] !== " " && xmlData[i] !== "\t" && xmlData[i] !== `
` && xmlData[i] !== "\r"; i++) {
          tagName += xmlData[i];
        }
        tagName = tagName.trim();
        if (tagName[tagName.length - 1] === "/") {
          tagName = tagName.substring(0, tagName.length - 1);
          i--;
        }
        if (!validateTagName(tagName)) {
          let msg;
          if (tagName.trim().length === 0) {
            msg = "Invalid space after '<'.";
          } else {
            msg = "Tag '" + tagName + "' is an invalid name.";
          }
          return getErrorObject("InvalidTag", msg, getLineNumberForPosition(xmlData, i));
        }
        const result = readAttributeStr(xmlData, i);
        if (result === false) {
          return getErrorObject("InvalidAttr", "Attributes for '" + tagName + "' have open quote.", getLineNumberForPosition(xmlData, i));
        }
        let attrStr = result.value;
        i = result.index;
        if (attrStr[attrStr.length - 1] === "/") {
          const attrStrStart = i - attrStr.length;
          attrStr = attrStr.substring(0, attrStr.length - 1);
          const isValid = validateAttributeString(attrStr, options);
          if (isValid === true) {
            tagFound = true;
          } else {
            return getErrorObject(isValid.err.code, isValid.err.msg, getLineNumberForPosition(xmlData, attrStrStart + isValid.err.line));
          }
        } else if (closingTag) {
          if (!result.tagClosed) {
            return getErrorObject("InvalidTag", "Closing tag '" + tagName + "' doesn't have proper closing.", getLineNumberForPosition(xmlData, i));
          } else if (attrStr.trim().length > 0) {
            return getErrorObject("InvalidTag", "Closing tag '" + tagName + "' can't have attributes or invalid starting.", getLineNumberForPosition(xmlData, tagStartPos));
          } else if (tags.length === 0) {
            return getErrorObject("InvalidTag", "Closing tag '" + tagName + "' has not been opened.", getLineNumberForPosition(xmlData, tagStartPos));
          } else {
            const otg = tags.pop();
            if (tagName !== otg.tagName) {
              let openPos = getLineNumberForPosition(xmlData, otg.tagStartPos);
              return getErrorObject("InvalidTag", "Expected closing tag '" + otg.tagName + "' (opened in line " + openPos.line + ", col " + openPos.col + ") instead of closing tag '" + tagName + "'.", getLineNumberForPosition(xmlData, tagStartPos));
            }
            if (tags.length == 0) {
              reachedRoot = true;
            }
          }
        } else {
          const isValid = validateAttributeString(attrStr, options);
          if (isValid !== true) {
            return getErrorObject(isValid.err.code, isValid.err.msg, getLineNumberForPosition(xmlData, i - attrStr.length + isValid.err.line));
          }
          if (reachedRoot === true) {
            return getErrorObject("InvalidXml", "Multiple possible root nodes found.", getLineNumberForPosition(xmlData, i));
          } else if (options.unpairedTags.indexOf(tagName) !== -1) {} else {
            tags.push({ tagName, tagStartPos });
          }
          tagFound = true;
        }
        for (i++;i < xmlData.length; i++) {
          if (xmlData[i] === "<") {
            if (xmlData[i + 1] === "!") {
              i++;
              i = readCommentAndCDATA(xmlData, i);
              continue;
            } else if (xmlData[i + 1] === "?") {
              i = readPI(xmlData, ++i);
              if (i.err)
                return i;
            } else {
              break;
            }
          } else if (xmlData[i] === "&") {
            const afterAmp = validateAmpersand(xmlData, i);
            if (afterAmp == -1)
              return getErrorObject("InvalidChar", "char '&' is not expected.", getLineNumberForPosition(xmlData, i));
            i = afterAmp;
          } else {
            if (reachedRoot === true && !isWhiteSpace(xmlData[i])) {
              return getErrorObject("InvalidXml", "Extra text at the end", getLineNumberForPosition(xmlData, i));
            }
          }
        }
        if (xmlData[i] === "<") {
          i--;
        }
      }
    } else {
      if (isWhiteSpace(xmlData[i])) {
        continue;
      }
      return getErrorObject("InvalidChar", "char '" + xmlData[i] + "' is not expected.", getLineNumberForPosition(xmlData, i));
    }
  }
  if (!tagFound) {
    return getErrorObject("InvalidXml", "Start tag expected.", 1);
  } else if (tags.length == 1) {
    return getErrorObject("InvalidTag", "Unclosed tag '" + tags[0].tagName + "'.", getLineNumberForPosition(xmlData, tags[0].tagStartPos));
  } else if (tags.length > 0) {
    return getErrorObject("InvalidXml", "Invalid '" + JSON.stringify(tags.map((t) => t.tagName), null, 4).replace(/\r?\n/g, "") + "' found.", { line: 1, col: 1 });
  }
  return true;
}
function isWhiteSpace(char) {
  return char === " " || char === "\t" || char === `
` || char === "\r";
}
function readPI(xmlData, i) {
  const start = i;
  for (;i < xmlData.length; i++) {
    if (xmlData[i] == "?" || xmlData[i] == " ") {
      const tagname = xmlData.substr(start, i - start);
      if (i > 5 && tagname === "xml") {
        return getErrorObject("InvalidXml", "XML declaration allowed only at the start of the document.", getLineNumberForPosition(xmlData, i));
      } else if (xmlData[i] == "?" && xmlData[i + 1] == ">") {
        i++;
        break;
      } else {
        continue;
      }
    }
  }
  return i;
}
function readCommentAndCDATA(xmlData, i) {
  if (xmlData.length > i + 5 && xmlData[i + 1] === "-" && xmlData[i + 2] === "-") {
    for (i += 3;i < xmlData.length; i++) {
      if (xmlData[i] === "-" && xmlData[i + 1] === "-" && xmlData[i + 2] === ">") {
        i += 2;
        break;
      }
    }
  } else if (xmlData.length > i + 8 && xmlData[i + 1] === "D" && xmlData[i + 2] === "O" && xmlData[i + 3] === "C" && xmlData[i + 4] === "T" && xmlData[i + 5] === "Y" && xmlData[i + 6] === "P" && xmlData[i + 7] === "E") {
    let angleBracketsCount = 1;
    for (i += 8;i < xmlData.length; i++) {
      if (xmlData[i] === "<") {
        angleBracketsCount++;
      } else if (xmlData[i] === ">") {
        angleBracketsCount--;
        if (angleBracketsCount === 0) {
          break;
        }
      }
    }
  } else if (xmlData.length > i + 9 && xmlData[i + 1] === "[" && xmlData[i + 2] === "C" && xmlData[i + 3] === "D" && xmlData[i + 4] === "A" && xmlData[i + 5] === "T" && xmlData[i + 6] === "A" && xmlData[i + 7] === "[") {
    for (i += 8;i < xmlData.length; i++) {
      if (xmlData[i] === "]" && xmlData[i + 1] === "]" && xmlData[i + 2] === ">") {
        i += 2;
        break;
      }
    }
  }
  return i;
}
var doubleQuote = '"';
var singleQuote = "'";
function readAttributeStr(xmlData, i) {
  let attrStr = "";
  let startChar = "";
  let tagClosed = false;
  for (;i < xmlData.length; i++) {
    if (xmlData[i] === doubleQuote || xmlData[i] === singleQuote) {
      if (startChar === "") {
        startChar = xmlData[i];
      } else if (startChar !== xmlData[i]) {} else {
        startChar = "";
      }
    } else if (xmlData[i] === ">") {
      if (startChar === "") {
        tagClosed = true;
        break;
      }
    }
    attrStr += xmlData[i];
  }
  if (startChar !== "") {
    return false;
  }
  return {
    value: attrStr,
    index: i,
    tagClosed
  };
}
var validAttrStrRegxp = new RegExp(`(\\s*)([^\\s=]+)(\\s*=)?(\\s*(['"])(([\\s\\S])*?)\\5)?`, "g");
function validateAttributeString(attrStr, options) {
  const matches = getAllMatches(attrStr, validAttrStrRegxp);
  const attrNames = {};
  for (let i = 0;i < matches.length; i++) {
    if (matches[i][1].length === 0) {
      return getErrorObject("InvalidAttr", "Attribute '" + matches[i][2] + "' has no space in starting.", getPositionFromMatch(matches[i]));
    } else if (matches[i][3] !== undefined && matches[i][4] === undefined) {
      return getErrorObject("InvalidAttr", "Attribute '" + matches[i][2] + "' is without value.", getPositionFromMatch(matches[i]));
    } else if (matches[i][3] === undefined && !options.allowBooleanAttributes) {
      return getErrorObject("InvalidAttr", "boolean attribute '" + matches[i][2] + "' is not allowed.", getPositionFromMatch(matches[i]));
    }
    const attrName = matches[i][2];
    if (!validateAttrName(attrName)) {
      return getErrorObject("InvalidAttr", "Attribute '" + attrName + "' is an invalid name.", getPositionFromMatch(matches[i]));
    }
    if (!Object.prototype.hasOwnProperty.call(attrNames, attrName)) {
      attrNames[attrName] = 1;
    } else {
      return getErrorObject("InvalidAttr", "Attribute '" + attrName + "' is repeated.", getPositionFromMatch(matches[i]));
    }
  }
  return true;
}
function validateNumberAmpersand(xmlData, i) {
  let re = /\d/;
  if (xmlData[i] === "x") {
    i++;
    re = /[\da-fA-F]/;
  }
  for (;i < xmlData.length; i++) {
    if (xmlData[i] === ";")
      return i;
    if (!xmlData[i].match(re))
      break;
  }
  return -1;
}
function validateAmpersand(xmlData, i) {
  i++;
  if (xmlData[i] === ";")
    return -1;
  if (xmlData[i] === "#") {
    i++;
    return validateNumberAmpersand(xmlData, i);
  }
  let count = 0;
  for (;i < xmlData.length; i++, count++) {
    if (xmlData[i].match(/\w/) && count < 20)
      continue;
    if (xmlData[i] === ";")
      break;
    return -1;
  }
  return i;
}
function getErrorObject(code, message, lineNumber) {
  return {
    err: {
      code,
      msg: message,
      line: lineNumber.line || lineNumber,
      col: lineNumber.col
    }
  };
}
function validateAttrName(attrName) {
  return isName(attrName);
}
function validateTagName(tagname) {
  return isName(tagname);
}
function getLineNumberForPosition(xmlData, index) {
  const lines = xmlData.substring(0, index).split(/\r?\n/);
  return {
    line: lines.length,
    col: lines[lines.length - 1].length + 1
  };
}
function getPositionFromMatch(match) {
  return match.startIndex + match[1].length;
}

// ../../node_modules/.bun/@nodable+entities@3.0.0/node_modules/@nodable/entities/src/entities.js
var CURRENCY = {
  cent: "¢",
  pound: "£",
  curren: "¤",
  yen: "¥",
  euro: "€",
  dollar: "$",
  fnof: "ƒ",
  inr: "₹",
  af: "؋",
  birr: "ብር",
  peso: "₱",
  rub: "₽",
  won: "₩",
  yuan: "¥",
  cedil: "¸"
};
var XML = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"'
};
var COMMON_HTML = {
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  para: "¶",
  sect: "§",
  deg: "°",
  frac12: "½",
  frac14: "¼",
  frac34: "¾"
};

// ../../node_modules/.bun/@nodable+entities@3.0.0/node_modules/@nodable/entities/src/EntityDecoder.js
var ENTITY_ACTION = Object.freeze({
  ALLOW: "allow",
  BLOCK: "block",
  THROW: "throw"
});
var SPECIAL_CHARS = new Set("!?\\\\/[]$%{}^&*()<>|+");
function validateEntityName(name) {
  if (name[0] === "#") {
    throw new Error(`[EntityReplacer] Invalid character '#' in entity name: "${name}"`);
  }
  for (const ch of name) {
    if (SPECIAL_CHARS.has(ch)) {
      throw new Error(`[EntityReplacer] Invalid character '${ch}' in entity name: "${name}"`);
    }
  }
  return name;
}
function mergeEntityMaps(...maps) {
  const out = Object.create(null);
  for (const map of maps) {
    if (!map)
      continue;
    for (const key of Object.keys(map)) {
      const raw = map[key];
      if (typeof raw === "string") {
        out[key] = raw;
      } else if (raw && typeof raw === "object" && raw.val !== undefined) {
        const val = raw.val;
        if (typeof val === "string") {
          out[key] = val;
        }
      }
    }
  }
  return out;
}
var LIMIT_TIER_EXTERNAL = "external";
var LIMIT_TIER_BASE = "base";
var LIMIT_TIER_ALL = "all";
function parseLimitTiers(raw) {
  if (!raw || raw === LIMIT_TIER_EXTERNAL)
    return new Set([LIMIT_TIER_EXTERNAL]);
  if (raw === LIMIT_TIER_ALL)
    return new Set([LIMIT_TIER_ALL]);
  if (raw === LIMIT_TIER_BASE)
    return new Set([LIMIT_TIER_BASE]);
  if (Array.isArray(raw))
    return new Set(raw);
  return new Set([LIMIT_TIER_EXTERNAL]);
}
var NCR_LEVEL = Object.freeze({ allow: 0, leave: 1, remove: 2, throw: 3 });
var XML10_ALLOWED_C0 = new Set([9, 10, 13]);
function parseNCRConfig(ncr) {
  if (!ncr) {
    return { xmlVersion: 1, onLevel: NCR_LEVEL.allow, nullLevel: NCR_LEVEL.remove };
  }
  const xmlVersion = ncr.xmlVersion === 1.1 ? 1.1 : 1;
  const onLevel = NCR_LEVEL[ncr.onNCR] ?? NCR_LEVEL.allow;
  const nullLevel = NCR_LEVEL[ncr.nullNCR] ?? NCR_LEVEL.remove;
  const clampedNull = Math.max(nullLevel, NCR_LEVEL.remove);
  return { xmlVersion, onLevel, nullLevel: clampedNull };
}

class EntityDecoder {
  constructor(options = {}) {
    this._limit = options.limit || {};
    this._maxTotalExpansions = this._limit.maxTotalExpansions || 0;
    this._maxExpandedLength = this._limit.maxExpandedLength || 0;
    this._postCheck = typeof options.postCheck === "function" ? options.postCheck : (r) => r;
    this._limitTiers = parseLimitTiers(this._limit.applyLimitsTo ?? LIMIT_TIER_EXTERNAL);
    this._numericAllowed = options.numericAllowed ?? true;
    this._baseMap = mergeEntityMaps(XML, options.namedEntities || null);
    this._externalMap = Object.create(null);
    this._inputMap = Object.create(null);
    this._totalExpansions = 0;
    this._expandedLength = 0;
    this._removeSet = new Set(options.remove && Array.isArray(options.remove) ? options.remove : []);
    this._leaveSet = new Set(options.leave && Array.isArray(options.leave) ? options.leave : []);
    const ncrCfg = parseNCRConfig(options.ncr);
    this._ncrXmlVersion = ncrCfg.xmlVersion;
    this._ncrOnLevel = ncrCfg.onLevel;
    this._ncrNullLevel = ncrCfg.nullLevel;
    this._onExternalEntity = typeof options.onExternalEntity === "function" ? options.onExternalEntity : null;
    this._onInputEntity = typeof options.onInputEntity === "function" ? options.onInputEntity : null;
  }
  _applyRegistrationHook(hook, name, value, context) {
    if (!hook)
      return true;
    const action = hook(name, value);
    if (action === ENTITY_ACTION.BLOCK)
      return false;
    if (action === ENTITY_ACTION.THROW) {
      throw new Error(`[EntityDecoder] Registration of ${context} entity "&${name};" was rejected by hook`);
    }
    return true;
  }
  setExternalEntities(map) {
    if (map) {
      for (const key of Object.keys(map)) {
        validateEntityName(key);
      }
    }
    if (!this._onExternalEntity) {
      this._externalMap = mergeEntityMaps(map);
      return;
    }
    const flat = mergeEntityMaps(map);
    const filtered = Object.create(null);
    for (const [name, value] of Object.entries(flat)) {
      if (this._applyRegistrationHook(this._onExternalEntity, name, value, "external")) {
        filtered[name] = value;
      }
    }
    this._externalMap = filtered;
  }
  addExternalEntity(key, value) {
    validateEntityName(key);
    if (typeof value === "string" && value.indexOf("&") === -1) {
      if (this._applyRegistrationHook(this._onExternalEntity, key, value, "external")) {
        this._externalMap[key] = value;
      }
    }
  }
  addInputEntities(map) {
    this._totalExpansions = 0;
    this._expandedLength = 0;
    if (!this._onInputEntity) {
      this._inputMap = mergeEntityMaps(map);
      return;
    }
    const flat = mergeEntityMaps(map);
    const filtered = Object.create(null);
    for (const [name, value] of Object.entries(flat)) {
      if (this._applyRegistrationHook(this._onInputEntity, name, value, "input")) {
        filtered[name] = value;
      }
    }
    this._inputMap = filtered;
  }
  reset() {
    this._inputMap = Object.create(null);
    this._totalExpansions = 0;
    this._expandedLength = 0;
    return this;
  }
  setXmlVersion(version) {
    this._ncrXmlVersion = version === 1.1 ? 1.1 : 1;
  }
  decode(str) {
    if (typeof str !== "string" || str.length === 0)
      return str;
    if (str.indexOf("&") === -1)
      return str;
    const original = str;
    const chunks = [];
    const len = str.length;
    let last = 0;
    let i = 0;
    const limitExpansions = this._maxTotalExpansions > 0;
    const limitLength = this._maxExpandedLength > 0;
    const checkLimits = limitExpansions || limitLength;
    while (i < len) {
      if (str.charCodeAt(i) !== 38) {
        i++;
        continue;
      }
      let j = i + 1;
      while (j < len && str.charCodeAt(j) !== 59 && j - i <= 32)
        j++;
      if (j >= len || str.charCodeAt(j) !== 59) {
        i++;
        continue;
      }
      const token = str.slice(i + 1, j);
      if (token.length === 0) {
        i++;
        continue;
      }
      let replacement;
      let tier;
      if (this._removeSet.has(token)) {
        replacement = "";
        if (tier === undefined) {
          tier = LIMIT_TIER_EXTERNAL;
        }
      } else if (this._leaveSet.has(token)) {
        i++;
        continue;
      } else if (token.charCodeAt(0) === 35) {
        const ncrResult = this._resolveNCR(token);
        if (ncrResult === undefined) {
          i++;
          continue;
        }
        replacement = ncrResult;
        tier = LIMIT_TIER_BASE;
      } else {
        const resolved = this._resolveName(token);
        replacement = resolved?.value;
        tier = resolved?.tier;
      }
      if (replacement === undefined) {
        i++;
        continue;
      }
      if (i > last)
        chunks.push(str.slice(last, i));
      chunks.push(replacement);
      last = j + 1;
      i = last;
      if (checkLimits && this._tierCounts(tier)) {
        if (limitExpansions) {
          this._totalExpansions++;
          if (this._totalExpansions > this._maxTotalExpansions) {
            throw new Error(`[EntityReplacer] Entity expansion count limit exceeded: ` + `${this._totalExpansions} > ${this._maxTotalExpansions}`);
          }
        }
        if (limitLength) {
          const delta = replacement.length - (token.length + 2);
          if (delta > 0) {
            this._expandedLength += delta;
            if (this._expandedLength > this._maxExpandedLength) {
              throw new Error(`[EntityReplacer] Expanded content length limit exceeded: ` + `${this._expandedLength} > ${this._maxExpandedLength}`);
            }
          }
        }
      }
    }
    if (last < len)
      chunks.push(str.slice(last));
    const result = chunks.length === 0 ? str : chunks.join("");
    return this._postCheck(result, original);
  }
  _tierCounts(tier) {
    if (this._limitTiers.has(LIMIT_TIER_ALL))
      return true;
    return this._limitTiers.has(tier);
  }
  _resolveName(name) {
    if (name in this._inputMap)
      return { value: this._inputMap[name], tier: LIMIT_TIER_EXTERNAL };
    if (name in this._externalMap)
      return { value: this._externalMap[name], tier: LIMIT_TIER_EXTERNAL };
    if (name in this._baseMap)
      return { value: this._baseMap[name], tier: LIMIT_TIER_BASE };
    return;
  }
  _classifyNCR(cp) {
    if (cp === 0)
      return this._ncrNullLevel;
    if (cp >= 55296 && cp <= 57343)
      return NCR_LEVEL.remove;
    if (this._ncrXmlVersion === 1) {
      if (cp >= 1 && cp <= 31 && !XML10_ALLOWED_C0.has(cp))
        return NCR_LEVEL.remove;
    }
    return -1;
  }
  _applyNCRAction(action, token, cp) {
    switch (action) {
      case NCR_LEVEL.allow:
        return String.fromCodePoint(cp);
      case NCR_LEVEL.remove:
        return "";
      case NCR_LEVEL.leave:
        return;
      case NCR_LEVEL.throw:
        throw new Error(`[EntityDecoder] Prohibited numeric character reference ` + `&${token}; (U+${cp.toString(16).toUpperCase().padStart(4, "0")})`);
      default:
        return String.fromCodePoint(cp);
    }
  }
  _resolveNCR(token) {
    const second = token.charCodeAt(1);
    let cp;
    if (second === 120 || second === 88) {
      cp = parseInt(token.slice(2), 16);
    } else {
      cp = parseInt(token.slice(1), 10);
    }
    if (Number.isNaN(cp) || cp < 0 || cp > 1114111)
      return;
    const minimum = this._classifyNCR(cp);
    if (!this._numericAllowed && minimum < NCR_LEVEL.remove)
      return;
    const effective = minimum === -1 ? this._ncrOnLevel : Math.max(this._ncrOnLevel, minimum);
    return this._applyNCRAction(effective, token, cp);
  }
}
// ../../node_modules/.bun/fast-xml-parser@5.10.1/node_modules/fast-xml-parser/src/xmlparser/OptionsBuilder.js
var defaultOnDangerousProperty = (name) => {
  if (DANGEROUS_PROPERTY_NAMES.includes(name)) {
    return "__" + name;
  }
  return name;
};
var defaultOptions2 = {
  preserveOrder: false,
  attributeNamePrefix: "@_",
  attributesGroupName: false,
  textNodeName: "#text",
  ignoreAttributes: true,
  removeNSPrefix: false,
  allowBooleanAttributes: false,
  parseTagValue: true,
  parseAttributeValue: false,
  trimValues: true,
  cdataPropName: false,
  numberParseOptions: {
    hex: true,
    leadingZeros: true,
    eNotation: true,
    unicode: false
  },
  tagValueProcessor: function(tagName, val) {
    return val;
  },
  attributeValueProcessor: function(attrName, val) {
    return val;
  },
  stopNodes: [],
  alwaysCreateTextNode: false,
  isArray: () => false,
  commentPropName: false,
  unpairedTags: [],
  processEntities: true,
  htmlEntities: false,
  entityDecoder: null,
  ignoreDeclaration: false,
  ignorePiTags: false,
  transformTagName: false,
  transformAttributeName: false,
  updateTag: function(tagName, jPath, attrs) {
    return tagName;
  },
  captureMetaData: false,
  maxNestedTags: 100,
  strictReservedNames: true,
  jPath: true,
  onDangerousProperty: defaultOnDangerousProperty
};
function validatePropertyName(propertyName, optionName) {
  if (typeof propertyName !== "string") {
    return;
  }
  const normalized = propertyName.toLowerCase();
  if (DANGEROUS_PROPERTY_NAMES.some((dangerous) => normalized === dangerous.toLowerCase())) {
    throw new Error(`[SECURITY] Invalid ${optionName}: "${propertyName}" is a reserved JavaScript keyword that could cause prototype pollution`);
  }
  if (criticalProperties.some((dangerous) => normalized === dangerous.toLowerCase())) {
    throw new Error(`[SECURITY] Invalid ${optionName}: "${propertyName}" is a reserved JavaScript keyword that could cause prototype pollution`);
  }
}
function normalizeProcessEntities(value, htmlEntities) {
  if (typeof value === "boolean") {
    return {
      enabled: value,
      maxEntitySize: 1e4,
      maxExpansionDepth: 1e4,
      maxTotalExpansions: Infinity,
      maxExpandedLength: 1e5,
      maxEntityCount: 1000,
      allowedTags: null,
      tagFilter: null,
      appliesTo: "all"
    };
  }
  if (typeof value === "object" && value !== null) {
    return {
      enabled: value.enabled !== false,
      maxEntitySize: Math.max(1, value.maxEntitySize ?? 1e4),
      maxExpansionDepth: Math.max(1, value.maxExpansionDepth ?? 1e4),
      maxTotalExpansions: Math.max(1, value.maxTotalExpansions ?? Infinity),
      maxExpandedLength: Math.max(1, value.maxExpandedLength ?? 1e5),
      maxEntityCount: Math.max(1, value.maxEntityCount ?? 1000),
      allowedTags: value.allowedTags ?? null,
      tagFilter: value.tagFilter ?? null,
      appliesTo: value.appliesTo ?? "all"
    };
  }
  return normalizeProcessEntities(true);
}
var buildOptions = function(options) {
  const built = Object.assign({}, defaultOptions2, options);
  const propertyNameOptions = [
    { value: built.attributeNamePrefix, name: "attributeNamePrefix" },
    { value: built.attributesGroupName, name: "attributesGroupName" },
    { value: built.textNodeName, name: "textNodeName" },
    { value: built.cdataPropName, name: "cdataPropName" },
    { value: built.commentPropName, name: "commentPropName" }
  ];
  for (const { value, name } of propertyNameOptions) {
    if (value) {
      validatePropertyName(value, name);
    }
  }
  if (built.onDangerousProperty === null) {
    built.onDangerousProperty = defaultOnDangerousProperty;
  }
  built.processEntities = normalizeProcessEntities(built.processEntities, built.htmlEntities);
  built.unpairedTagsSet = new Set(built.unpairedTags);
  if (built.stopNodes && Array.isArray(built.stopNodes)) {
    built.stopNodes = built.stopNodes.map((node) => {
      if (typeof node === "string" && node.startsWith("*.")) {
        return ".." + node.substring(2);
      }
      return node;
    });
  }
  return built;
};

// ../../node_modules/.bun/fast-xml-parser@5.10.1/node_modules/fast-xml-parser/src/xmlparser/xmlNode.js
var METADATA_SYMBOL;
if (typeof Symbol !== "function") {
  METADATA_SYMBOL = "@@xmlMetadata";
} else {
  METADATA_SYMBOL = Symbol("XML Node Metadata");
}

class XmlNode {
  constructor(tagname) {
    this.tagname = tagname;
    this.child = [];
    this[":@"] = Object.create(null);
  }
  add(key, val) {
    if (key === "__proto__")
      key = "#__proto__";
    this.child.push({ [key]: val });
  }
  addChild(node, startIndex) {
    if (node.tagname === "__proto__")
      node.tagname = "#__proto__";
    if (node[":@"] && Object.keys(node[":@"]).length > 0) {
      this.child.push({ [node.tagname]: node.child, [":@"]: node[":@"] });
    } else {
      this.child.push({ [node.tagname]: node.child });
    }
    if (startIndex !== undefined) {
      this.child[this.child.length - 1][METADATA_SYMBOL] = { startIndex };
    }
  }
  static getMetaDataSymbol() {
    return METADATA_SYMBOL;
  }
}

// ../../node_modules/.bun/xml-naming@0.3.0/node_modules/xml-naming/src/index.js
var nameStartChar10 = ":A-Za-z_" + "À-ÖØ-öø-˿" + "Ͱ-ͽ" + "Ϳ-҆҈-῿" + "‌-‍" + "⁰-↏" + "Ⰰ-⿯" + "、-퟿" + "豈-﷏" + "ﷰ-�";
var nameChar10 = nameStartChar10 + "\\-\\.\\d" + "·" + "̀-ͯ" + "‿-⁀";
var nameStartChar11 = ":A-Za-z_" + "À-˿" + "Ͱ-ͽ" + "Ϳ-҆҈-῿" + "‌-‍" + "⁰-↏" + "Ⰰ-⿯" + "、-퟿" + "豈-﷏" + "ﷰ-�" + "\uD800\uDC00-\uDB7F\uDFFF";
var nameChar11 = nameStartChar11 + "\\-\\.\\d" + "·" + "̀-ͯ" + "҇" + "‿-⁀";
var buildRegexes = (startChar, char, flags = "") => {
  const ncStart = startChar.replace(":", "");
  const ncChar = char.replace(":", "");
  const ncNamePat = `[${ncStart}][${ncChar}]*`;
  return {
    name: new RegExp(`^[${startChar}][${char}]*$`, flags),
    ncName: new RegExp(`^${ncNamePat}$`, flags),
    qName: new RegExp(`^${ncNamePat}(?::${ncNamePat})?$`, flags),
    nmToken: new RegExp(`^[${char}]+$`, flags),
    nmTokens: new RegExp(`^[${char}]+(?:\\s+[${char}]+)*$`, flags)
  };
};
var regexes10 = buildRegexes(nameStartChar10, nameChar10);
var regexes11 = buildRegexes(nameStartChar11, nameChar11, "u");
var nameStartCharAscii = ":A-Za-z_";
var nameCharAscii = nameStartCharAscii + "\\-\\.\\d";
var regexesAscii = buildRegexes(nameStartCharAscii, nameCharAscii);
var getRegexes = (xmlVersion = "1.0", asciiOnly = false) => {
  if (asciiOnly)
    return regexesAscii;
  return xmlVersion === "1.1" ? regexes11 : regexes10;
};
var qName = (str, { xmlVersion = "1.0", asciiOnly = false } = {}) => getRegexes(xmlVersion, asciiOnly).qName.test(str);

// ../../node_modules/.bun/fast-xml-parser@5.10.1/node_modules/fast-xml-parser/src/xmlparser/DocTypeReader.js
class DocTypeReader {
  constructor(options, xmlVersion) {
    this.suppressValidationErr = !options;
    this.options = options;
    this.xmlVersion = xmlVersion || 1;
  }
  setXmlVersion(xmlVersion = 1) {
    this.xmlVersion = xmlVersion;
  }
  readDocType(xmlData, i) {
    const entities = Object.create(null);
    let entityCount = 0;
    if (xmlData[i + 3] === "O" && xmlData[i + 4] === "C" && xmlData[i + 5] === "T" && xmlData[i + 6] === "Y" && xmlData[i + 7] === "P" && xmlData[i + 8] === "E") {
      i = i + 9;
      let angleBracketsCount = 1;
      let hasBody = false, comment = false;
      let exp = "";
      for (;i < xmlData.length; i++) {
        if (xmlData[i] === "<" && !comment) {
          if (hasBody && hasSeq(xmlData, "!ENTITY", i)) {
            i += 7;
            let entityName, val;
            [entityName, val, i] = this.readEntityExp(xmlData, i + 1, this.suppressValidationErr);
            if (val.indexOf("&") === -1) {
              if (this.options.enabled !== false && this.options.maxEntityCount != null && entityCount >= this.options.maxEntityCount) {
                throw new Error(`Entity count (${entityCount + 1}) exceeds maximum allowed (${this.options.maxEntityCount})`);
              }
              entities[entityName] = val;
              entityCount++;
            }
          } else if (hasBody && hasSeq(xmlData, "!ELEMENT", i)) {
            i += 8;
            const { index } = this.readElementExp(xmlData, i + 1);
            i = index;
          } else if (hasBody && hasSeq(xmlData, "!ATTLIST", i)) {
            i += 8;
          } else if (hasBody && hasSeq(xmlData, "!NOTATION", i)) {
            i += 9;
            const { index } = this.readNotationExp(xmlData, i + 1, this.suppressValidationErr);
            i = index;
          } else if (hasSeq(xmlData, "!--", i))
            comment = true;
          else
            throw new Error(`Invalid DOCTYPE`);
          angleBracketsCount++;
          exp = "";
        } else if (xmlData[i] === ">") {
          if (comment) {
            if (xmlData[i - 1] === "-" && xmlData[i - 2] === "-") {
              comment = false;
              angleBracketsCount--;
            }
          } else {
            angleBracketsCount--;
          }
          if (angleBracketsCount === 0) {
            break;
          }
        } else if (xmlData[i] === "[") {
          hasBody = true;
        } else {
          exp += xmlData[i];
        }
      }
      if (angleBracketsCount !== 0) {
        throw new Error(`Unclosed DOCTYPE`);
      }
    } else {
      throw new Error(`Invalid Tag instead of DOCTYPE`);
    }
    return { entities, i };
  }
  readEntityExp(xmlData, i) {
    i = skipWhitespace(xmlData, i);
    const startIndex = i;
    while (i < xmlData.length && !/\s/.test(xmlData[i]) && xmlData[i] !== '"' && xmlData[i] !== "'") {
      i++;
    }
    let entityName = xmlData.substring(startIndex, i);
    validateEntityName2(entityName, { xmlVersion: this.xmlVersion });
    i = skipWhitespace(xmlData, i);
    if (!this.suppressValidationErr) {
      if (xmlData.substring(i, i + 6).toUpperCase() === "SYSTEM") {
        throw new Error("External entities are not supported");
      } else if (xmlData[i] === "%") {
        throw new Error("Parameter entities are not supported");
      }
    }
    let entityValue = "";
    [i, entityValue] = this.readIdentifierVal(xmlData, i, "entity");
    if (this.options.enabled !== false && this.options.maxEntitySize != null && entityValue.length > this.options.maxEntitySize) {
      throw new Error(`Entity "${entityName}" size (${entityValue.length}) exceeds maximum allowed size (${this.options.maxEntitySize})`);
    }
    i--;
    return [entityName, entityValue, i];
  }
  readNotationExp(xmlData, i) {
    i = skipWhitespace(xmlData, i);
    const startIndex = i;
    while (i < xmlData.length && !/\s/.test(xmlData[i])) {
      i++;
    }
    let notationName = xmlData.substring(startIndex, i);
    !this.suppressValidationErr && validateEntityName2(notationName, { xmlVersion: this.xmlVersion });
    i = skipWhitespace(xmlData, i);
    const identifierType = xmlData.substring(i, i + 6).toUpperCase();
    if (!this.suppressValidationErr && identifierType !== "SYSTEM" && identifierType !== "PUBLIC") {
      throw new Error(`Expected SYSTEM or PUBLIC, found "${identifierType}"`);
    }
    i += identifierType.length;
    i = skipWhitespace(xmlData, i);
    let publicIdentifier = null;
    let systemIdentifier = null;
    if (identifierType === "PUBLIC") {
      [i, publicIdentifier] = this.readIdentifierVal(xmlData, i, "publicIdentifier");
      i = skipWhitespace(xmlData, i);
      if (xmlData[i] === '"' || xmlData[i] === "'") {
        [i, systemIdentifier] = this.readIdentifierVal(xmlData, i, "systemIdentifier");
      }
    } else if (identifierType === "SYSTEM") {
      [i, systemIdentifier] = this.readIdentifierVal(xmlData, i, "systemIdentifier");
      if (!this.suppressValidationErr && !systemIdentifier) {
        throw new Error("Missing mandatory system identifier for SYSTEM notation");
      }
    }
    return { notationName, publicIdentifier, systemIdentifier, index: --i };
  }
  readIdentifierVal(xmlData, i, type) {
    let identifierVal = "";
    const startChar = xmlData[i];
    if (startChar !== '"' && startChar !== "'") {
      throw new Error(`Expected quoted string, found "${startChar}"`);
    }
    i++;
    const startIndex = i;
    while (i < xmlData.length && xmlData[i] !== startChar) {
      i++;
    }
    identifierVal = xmlData.substring(startIndex, i);
    if (xmlData[i] !== startChar) {
      throw new Error(`Unterminated ${type} value`);
    }
    i++;
    return [i, identifierVal];
  }
  readElementExp(xmlData, i) {
    i = skipWhitespace(xmlData, i);
    const startIndex = i;
    while (i < xmlData.length && !/\s/.test(xmlData[i])) {
      i++;
    }
    let elementName = xmlData.substring(startIndex, i);
    if (!this.suppressValidationErr && !qName(elementName, { xmlVersion: this.xmlVersion })) {
      throw new Error(`Invalid element name: "${elementName}"`);
    }
    i = skipWhitespace(xmlData, i);
    let contentModel = "";
    if (xmlData[i] === "E" && hasSeq(xmlData, "MPTY", i))
      i += 4;
    else if (xmlData[i] === "A" && hasSeq(xmlData, "NY", i))
      i += 2;
    else if (xmlData[i] === "(") {
      i++;
      const startIndex2 = i;
      while (i < xmlData.length && xmlData[i] !== ")") {
        i++;
      }
      contentModel = xmlData.substring(startIndex2, i);
      if (xmlData[i] !== ")") {
        throw new Error("Unterminated content model");
      }
    } else if (!this.suppressValidationErr) {
      throw new Error(`Invalid Element Expression, found "${xmlData[i]}"`);
    }
    return {
      elementName,
      contentModel: contentModel.trim(),
      index: i
    };
  }
  readAttlistExp(xmlData, i) {
    i = skipWhitespace(xmlData, i);
    let startIndex = i;
    while (i < xmlData.length && !/\s/.test(xmlData[i])) {
      i++;
    }
    let elementName = xmlData.substring(startIndex, i);
    validateEntityName2(elementName, { xmlVersion: this.xmlVersion });
    i = skipWhitespace(xmlData, i);
    startIndex = i;
    while (i < xmlData.length && !/\s/.test(xmlData[i])) {
      i++;
    }
    let attributeName = xmlData.substring(startIndex, i);
    if (!validateEntityName2(attributeName, { xmlVersion: this.xmlVersion })) {
      throw new Error(`Invalid attribute name: "${attributeName}"`);
    }
    i = skipWhitespace(xmlData, i);
    let attributeType = "";
    if (xmlData.substring(i, i + 8).toUpperCase() === "NOTATION") {
      attributeType = "NOTATION";
      i += 8;
      i = skipWhitespace(xmlData, i);
      if (xmlData[i] !== "(") {
        throw new Error(`Expected '(', found "${xmlData[i]}"`);
      }
      i++;
      let allowedNotations = [];
      while (i < xmlData.length && xmlData[i] !== ")") {
        const startIndex2 = i;
        while (i < xmlData.length && xmlData[i] !== "|" && xmlData[i] !== ")") {
          i++;
        }
        let notation = xmlData.substring(startIndex2, i);
        notation = notation.trim();
        if (!validateEntityName2(notation, { xmlVersion: this.xmlVersion })) {
          throw new Error(`Invalid notation name: "${notation}"`);
        }
        allowedNotations.push(notation);
        if (xmlData[i] === "|") {
          i++;
          i = skipWhitespace(xmlData, i);
        }
      }
      if (xmlData[i] !== ")") {
        throw new Error("Unterminated list of notations");
      }
      i++;
      attributeType += " (" + allowedNotations.join("|") + ")";
    } else {
      const startIndex2 = i;
      while (i < xmlData.length && !/\s/.test(xmlData[i])) {
        i++;
      }
      attributeType += xmlData.substring(startIndex2, i);
      const validTypes = ["CDATA", "ID", "IDREF", "IDREFS", "ENTITY", "ENTITIES", "NMTOKEN", "NMTOKENS"];
      if (!this.suppressValidationErr && !validTypes.includes(attributeType.toUpperCase())) {
        throw new Error(`Invalid attribute type: "${attributeType}"`);
      }
    }
    i = skipWhitespace(xmlData, i);
    let defaultValue = "";
    if (xmlData.substring(i, i + 8).toUpperCase() === "#REQUIRED") {
      defaultValue = "#REQUIRED";
      i += 8;
    } else if (xmlData.substring(i, i + 7).toUpperCase() === "#IMPLIED") {
      defaultValue = "#IMPLIED";
      i += 7;
    } else {
      [i, defaultValue] = this.readIdentifierVal(xmlData, i, "ATTLIST");
    }
    return {
      elementName,
      attributeName,
      attributeType,
      defaultValue,
      index: i
    };
  }
}
var skipWhitespace = (data, index) => {
  while (index < data.length && /\s/.test(data[index])) {
    index++;
  }
  return index;
};
function hasSeq(data, seq, i) {
  for (let j = 0;j < seq.length; j++) {
    if (seq[j] !== data[i + j + 1])
      return false;
  }
  return true;
}
function validateEntityName2(name, xmlVersion) {
  if (qName(name, { xmlVersion }))
    return name;
  else
    throw new Error(`Invalid entity name ${name}`);
}

// ../../node_modules/.bun/anynum@1.0.1/node_modules/anynum/digitTable.js
var SCRIPT_ZEROS = [
  48,
  1632,
  1776,
  2406,
  2534,
  2662,
  2790,
  2918,
  3046,
  3174,
  3302,
  3430,
  3558,
  3664,
  3792,
  3872,
  4160,
  4240,
  6112,
  6160,
  6470,
  6608,
  6784,
  6800,
  6992,
  7088,
  7232,
  7248,
  65296,
  120782,
  120792,
  120802,
  120812,
  120822,
  66720,
  68912,
  69734,
  69872,
  69942,
  70096,
  70384,
  70736,
  70864,
  71248,
  71360,
  71472,
  71904,
  72016,
  72688,
  72784,
  73040,
  73120,
  73552,
  92768,
  92864,
  93008,
  123200,
  123632,
  124144,
  125264,
  130032
];
var NOT_DIGIT = 255;
var HIGH_MAP = new Map;
var LOW_MAX = 65535;
var LOW_MIN = 1632;
var TABLE_OFFSET = LOW_MIN;
var TABLE_SIZE = LOW_MAX - LOW_MIN + 1;
var TABLE = new Uint8Array(TABLE_SIZE).fill(NOT_DIGIT);
for (const zero of SCRIPT_ZEROS) {
  for (let d = 0;d < 10; d++) {
    const cp = zero + d;
    if (cp <= LOW_MAX) {
      TABLE[cp - TABLE_OFFSET] = d;
    } else {
      HIGH_MAP.set(cp, d);
    }
  }
}

// ../../node_modules/.bun/anynum@1.0.1/node_modules/anynum/anynum.js
var CHAR_0 = 48;
var CHAR_9 = 57;
var CHAR_MINUS = 45;
var MINUS_SET = new Set([8722, 65293, 65123]);
function anynum(str) {
  if (typeof str !== "string")
    return str;
  const len = str.length;
  if (len === 0)
    return str;
  let firstHit = -1;
  for (let i = 0;i < len; i++) {
    const cc = str.charCodeAt(i);
    if (cc >= CHAR_0 && cc <= CHAR_9 || cc === CHAR_MINUS)
      continue;
    if (cc < TABLE_OFFSET) {
      if (MINUS_SET.has(cc)) {
        firstHit = i;
        break;
      }
      continue;
    }
    if (cc >= 55296 && cc <= 56319) {
      if (i + 1 < len) {
        const low = str.charCodeAt(i + 1);
        if (low >= 56320 && low <= 57343) {
          const cp = 65536 + (cc - 55296 << 10) + (low - 56320);
          if (HIGH_MAP.has(cp)) {
            firstHit = i;
            break;
          }
        }
      }
      continue;
    }
    if (TABLE[cc - TABLE_OFFSET] !== NOT_DIGIT || MINUS_SET.has(cc)) {
      firstHit = i;
      break;
    }
  }
  if (firstHit === -1)
    return str;
  const chars = [];
  if (firstHit > 0)
    chars.push(str.slice(0, firstHit));
  for (let i = firstHit;i < len; i++) {
    const cc = str.charCodeAt(i);
    if (cc >= CHAR_0 && cc <= CHAR_9 || cc === CHAR_MINUS) {
      chars.push(str[i]);
      continue;
    }
    if (cc < TABLE_OFFSET) {
      chars.push(MINUS_SET.has(cc) ? "-" : str[i]);
      continue;
    }
    if (cc >= 55296 && cc <= 56319) {
      if (i + 1 < len) {
        const low = str.charCodeAt(i + 1);
        if (low >= 56320 && low <= 57343) {
          const cp = 65536 + (cc - 55296 << 10) + (low - 56320);
          const d2 = HIGH_MAP.get(cp);
          if (d2 !== undefined) {
            chars.push(String.fromCharCode(d2 + 48));
            i++;
            continue;
          }
        }
      }
      chars.push(str[i]);
      continue;
    }
    if (MINUS_SET.has(cc)) {
      chars.push("-");
      continue;
    }
    const d = TABLE[cc - TABLE_OFFSET];
    chars.push(d !== NOT_DIGIT ? String.fromCharCode(d + 48) : str[i]);
  }
  return chars.join("");
}
var anynum_default = anynum;

// ../../node_modules/.bun/strnum@2.4.1/node_modules/strnum/strnum.js
var hexRegex = /^[-+]?0x[a-fA-F0-9]+$/;
var binRegex = /^0b[01]+$/;
var octRegex = /^0o[0-7]+$/;
var numRegex = /^([\-\+])?(0*)([0-9]*(\.[0-9]*)?)$/;
var consider = {
  hex: true,
  binary: false,
  octal: false,
  leadingZeros: true,
  decimalPoint: ".",
  eNotation: true,
  infinity: "original",
  unicode: false
};
function toNumber(str, options = {}) {
  options = Object.assign({}, consider, options);
  if (!str || typeof str !== "string")
    return str;
  let trimmedStr = str.trim();
  if (trimmedStr.length === 0)
    return str;
  else if (options.skipLike !== undefined && options.skipLike.test(trimmedStr))
    return str;
  else if (trimmedStr === "0")
    return 0;
  if (options.unicode) {
    trimmedStr = anynum_default(trimmedStr);
    if (trimmedStr === "0")
      return 0;
  }
  if (options.hex && hexRegex.test(trimmedStr)) {
    return parse_int(trimmedStr, 16);
  } else if (options.binary && binRegex.test(trimmedStr)) {
    return parse_int(trimmedStr, 2);
  } else if (options.octal && octRegex.test(trimmedStr)) {
    return parse_int(trimmedStr, 8);
  } else if (!isFinite(trimmedStr)) {
    return handleInfinity(str, Number(trimmedStr), options);
  } else if (trimmedStr.includes("e") || trimmedStr.includes("E")) {
    return resolveEnotation(str, trimmedStr, options);
  } else {
    const match = numRegex.exec(trimmedStr);
    if (match) {
      const sign = match[1] || "";
      const leadingZeros = match[2];
      let numTrimmedByZeros = trimZeros(match[3]);
      const decimalAdjacentToLeadingZeros = sign ? str[leadingZeros.length + 1] === "." : str[leadingZeros.length] === ".";
      if (!options.leadingZeros && (leadingZeros.length > 1 || leadingZeros.length === 1 && !decimalAdjacentToLeadingZeros)) {
        return str;
      } else {
        const num = Number(trimmedStr);
        const parsedStr = String(num);
        if (num === 0)
          return num;
        if (parsedStr.search(/[eE]/) !== -1) {
          if (options.eNotation)
            return num;
          else
            return str;
        } else if (trimmedStr.indexOf(".") !== -1) {
          if (parsedStr === "0")
            return num;
          else if (parsedStr === numTrimmedByZeros)
            return num;
          else if (parsedStr === `${sign}${numTrimmedByZeros}`)
            return num;
          else
            return str;
        }
        let n = leadingZeros ? numTrimmedByZeros : trimmedStr;
        if (leadingZeros) {
          return n === parsedStr || sign + n === parsedStr ? num : str;
        } else {
          return n === parsedStr || n === sign + parsedStr ? num : str;
        }
      }
    } else {
      return str;
    }
  }
}
var eNotationRegx = /^([-+])?(0*)(\d*(\.\d*)?[eE][-\+]?\d+)$/;
function resolveEnotation(str, trimmedStr, options) {
  if (!options.eNotation)
    return str;
  const notation = trimmedStr.match(eNotationRegx);
  if (notation) {
    let sign = notation[1] || "";
    const eChar = notation[3].indexOf("e") === -1 ? "E" : "e";
    const leadingZeros = notation[2];
    const eAdjacentToLeadingZeros = sign ? str[leadingZeros.length + 1] === eChar : str[leadingZeros.length] === eChar;
    if (leadingZeros.length > 1 && eAdjacentToLeadingZeros)
      return str;
    else if (leadingZeros.length === 1 && (notation[3].startsWith(`.${eChar}`) || notation[3][0] === eChar)) {
      return Number(trimmedStr);
    } else if (leadingZeros.length > 0) {
      if (options.leadingZeros && !eAdjacentToLeadingZeros) {
        trimmedStr = (notation[1] || "") + notation[3];
        return Number(trimmedStr);
      } else
        return str;
    } else {
      return Number(trimmedStr);
    }
  } else {
    return str;
  }
}
function trimZeros(numStr) {
  if (numStr && numStr.indexOf(".") !== -1) {
    numStr = numStr.replace(/0+$/, "");
    if (numStr === ".")
      numStr = "0";
    else if (numStr[0] === ".")
      numStr = "0" + numStr;
    else if (numStr[numStr.length - 1] === ".")
      numStr = numStr.substring(0, numStr.length - 1);
    return numStr;
  }
  return numStr;
}
function parse_int(numStr, base) {
  const str = numStr.trim();
  if (base === 2 || base === 8)
    numStr = str.substring(2);
  if (parseInt)
    return parseInt(numStr, base);
  else if (Number.parseInt)
    return Number.parseInt(numStr, base);
  else if (window && window.parseInt)
    return window.parseInt(numStr, base);
  else
    throw new Error("parseInt, Number.parseInt, window.parseInt are not supported");
}
function handleInfinity(str, num, options) {
  const isPositive = num === Infinity;
  switch (options.infinity.toLowerCase()) {
    case "null":
      return null;
    case "infinity":
      return num;
    case "string":
      return isPositive ? "Infinity" : "-Infinity";
    case "original":
    default:
      return str;
  }
}

// ../../node_modules/.bun/fast-xml-parser@5.10.1/node_modules/fast-xml-parser/src/ignoreAttributes.js
function getIgnoreAttributesFn(ignoreAttributes) {
  if (typeof ignoreAttributes === "function") {
    return ignoreAttributes;
  }
  if (Array.isArray(ignoreAttributes)) {
    return (attrName) => {
      for (const pattern of ignoreAttributes) {
        if (typeof pattern === "string" && attrName === pattern) {
          return true;
        }
        if (pattern instanceof RegExp && pattern.test(attrName)) {
          return true;
        }
      }
    };
  }
  return () => false;
}

// ../../node_modules/.bun/path-expression-matcher@1.6.2/node_modules/path-expression-matcher/src/Expression.js
class Expression {
  constructor(pattern, options = {}, data) {
    this.pattern = pattern;
    this.separator = options.separator || ".";
    this.segments = this._parse(pattern);
    this.data = data;
    this._hasDeepWildcard = this.segments.some((seg) => seg.type === "deep-wildcard");
    this._hasAttributeCondition = this.segments.some((seg) => seg.attrName !== undefined);
    this._hasPositionSelector = this.segments.some((seg) => seg.position !== undefined);
  }
  _parse(pattern) {
    const segments = [];
    let i = 0;
    let currentPart = "";
    while (i < pattern.length) {
      if (pattern[i] === this.separator) {
        if (i + 1 < pattern.length && pattern[i + 1] === this.separator) {
          if (currentPart.trim()) {
            segments.push(this._parseSegment(currentPart.trim()));
            currentPart = "";
          }
          segments.push({ type: "deep-wildcard" });
          i += 2;
        } else {
          if (currentPart.trim()) {
            segments.push(this._parseSegment(currentPart.trim()));
          }
          currentPart = "";
          i++;
        }
      } else {
        currentPart += pattern[i];
        i++;
      }
    }
    if (currentPart.trim()) {
      segments.push(this._parseSegment(currentPart.trim()));
    }
    return segments;
  }
  _parseSegment(part) {
    const segment = { type: "tag" };
    let bracketContent = null;
    let withoutBrackets = part;
    const bracketMatch = part.match(/^([^\[]+)(\[[^\]]*\])(.*)$/);
    if (bracketMatch) {
      withoutBrackets = bracketMatch[1] + bracketMatch[3];
      if (bracketMatch[2]) {
        const content = bracketMatch[2].slice(1, -1);
        if (content) {
          bracketContent = content;
        }
      }
    }
    let namespace = undefined;
    let tagAndPosition = withoutBrackets;
    if (withoutBrackets.includes("::")) {
      const nsIndex = withoutBrackets.indexOf("::");
      namespace = withoutBrackets.substring(0, nsIndex).trim();
      tagAndPosition = withoutBrackets.substring(nsIndex + 2).trim();
      if (!namespace) {
        throw new Error(`Invalid namespace in pattern: ${part}`);
      }
    }
    let tag = undefined;
    let positionMatch = null;
    if (tagAndPosition.includes(":")) {
      const colonIndex = tagAndPosition.lastIndexOf(":");
      const tagPart = tagAndPosition.substring(0, colonIndex).trim();
      const posPart = tagAndPosition.substring(colonIndex + 1).trim();
      const isPositionKeyword = ["first", "last", "odd", "even"].includes(posPart) || /^nth\(\d+\)$/.test(posPart);
      if (isPositionKeyword) {
        tag = tagPart;
        positionMatch = posPart;
      } else {
        tag = tagAndPosition;
      }
    } else {
      tag = tagAndPosition;
    }
    if (!tag) {
      throw new Error(`Invalid segment pattern: ${part}`);
    }
    segment.tag = tag;
    if (namespace) {
      segment.namespace = namespace;
    }
    if (bracketContent) {
      if (bracketContent.includes("=")) {
        const eqIndex = bracketContent.indexOf("=");
        segment.attrName = bracketContent.substring(0, eqIndex).trim();
        segment.attrValue = bracketContent.substring(eqIndex + 1).trim();
      } else {
        segment.attrName = bracketContent.trim();
      }
    }
    if (positionMatch) {
      const nthMatch = positionMatch.match(/^nth\((\d+)\)$/);
      if (nthMatch) {
        segment.position = "nth";
        segment.positionValue = parseInt(nthMatch[1], 10);
      } else {
        segment.position = positionMatch;
      }
    }
    return segment;
  }
  get length() {
    return this.segments.length;
  }
  hasDeepWildcard() {
    return this._hasDeepWildcard;
  }
  hasAttributeCondition() {
    return this._hasAttributeCondition;
  }
  hasPositionSelector() {
    return this._hasPositionSelector;
  }
  toString() {
    return this.pattern;
  }
}

// ../../node_modules/.bun/path-expression-matcher@1.6.2/node_modules/path-expression-matcher/src/ExpressionSet.js
class ExpressionSet {
  constructor() {
    this._byDepthAndTag = new Map;
    this._wildcardByDepth = new Map;
    this._deepWildcards = [];
    this._deepByTerminalTag = new Map;
    this._patterns = new Set;
    this._sealed = false;
  }
  add(expression) {
    if (this._sealed) {
      throw new TypeError("ExpressionSet is sealed. Create a new ExpressionSet to add more expressions.");
    }
    if (this._patterns.has(expression.pattern))
      return this;
    this._patterns.add(expression.pattern);
    if (expression.hasDeepWildcard()) {
      const lastSeg2 = expression.segments[expression.segments.length - 1];
      if (lastSeg2 && lastSeg2.type !== "deep-wildcard" && lastSeg2.tag !== "*") {
        const tag2 = lastSeg2.tag;
        if (!this._deepByTerminalTag.has(tag2))
          this._deepByTerminalTag.set(tag2, []);
        this._deepByTerminalTag.get(tag2).push(expression);
      } else {
        this._deepWildcards.push(expression);
      }
      return this;
    }
    const depth = expression.length;
    const lastSeg = expression.segments[expression.segments.length - 1];
    const tag = lastSeg?.tag;
    if (!tag || tag === "*") {
      if (!this._wildcardByDepth.has(depth))
        this._wildcardByDepth.set(depth, []);
      this._wildcardByDepth.get(depth).push(expression);
    } else {
      const key = `${depth}:${tag}`;
      if (!this._byDepthAndTag.has(key))
        this._byDepthAndTag.set(key, []);
      this._byDepthAndTag.get(key).push(expression);
    }
    return this;
  }
  addAll(expressions) {
    for (const expr of expressions)
      this.add(expr);
    return this;
  }
  has(expression) {
    return this._patterns.has(expression.pattern);
  }
  get size() {
    return this._patterns.size;
  }
  seal() {
    this._sealed = true;
    return this;
  }
  get isSealed() {
    return this._sealed;
  }
  matchesAny(matcher) {
    return this.findMatch(matcher) !== null;
  }
  findMatch(matcher) {
    const depth = matcher.getDepth();
    const tag = matcher.getCurrentTag();
    const exactKey = `${depth}:${tag}`;
    const exactBucket = this._byDepthAndTag.get(exactKey);
    if (exactBucket) {
      for (let i = 0;i < exactBucket.length; i++) {
        if (matcher.matches(exactBucket[i]))
          return exactBucket[i];
      }
    }
    const wildcardBucket = this._wildcardByDepth.get(depth);
    if (wildcardBucket) {
      for (let i = 0;i < wildcardBucket.length; i++) {
        if (matcher.matches(wildcardBucket[i]))
          return wildcardBucket[i];
      }
    }
    const deepBucket = this._deepByTerminalTag.get(tag);
    if (deepBucket) {
      for (let i = 0;i < deepBucket.length; i++) {
        if (matcher.matches(deepBucket[i]))
          return deepBucket[i];
      }
    }
    for (let i = 0;i < this._deepWildcards.length; i++) {
      if (matcher.matches(this._deepWildcards[i]))
        return this._deepWildcards[i];
    }
    return null;
  }
}

// ../../node_modules/.bun/path-expression-matcher@1.6.2/node_modules/path-expression-matcher/src/Matcher.js
class MatcherView {
  constructor(matcher) {
    this._matcher = matcher;
  }
  get separator() {
    return this._matcher.separator;
  }
  getCurrentTag() {
    const path = this._matcher.path;
    return path.length > 0 ? path[path.length - 1].tag : undefined;
  }
  getCurrentNamespace() {
    const path = this._matcher.path;
    return path.length > 0 ? path[path.length - 1].namespace : undefined;
  }
  getAttrValue(attrName) {
    const path = this._matcher.path;
    if (path.length === 0)
      return;
    return path[path.length - 1].values?.[attrName];
  }
  hasAttr(attrName) {
    const path = this._matcher.path;
    if (path.length === 0)
      return false;
    const current = path[path.length - 1];
    return current.values !== undefined && attrName in current.values;
  }
  getAnyParentAttr(attrName) {
    return this._matcher.getAnyParentAttr(attrName);
  }
  hasAnyParentAttr(attrName) {
    return this._matcher.hasAnyParentAttr(attrName);
  }
  getPosition() {
    const path = this._matcher.path;
    if (path.length === 0)
      return -1;
    return path[path.length - 1].position ?? 0;
  }
  getCounter() {
    const path = this._matcher.path;
    if (path.length === 0)
      return -1;
    return path[path.length - 1].counter ?? 0;
  }
  getIndex() {
    return this.getPosition();
  }
  getDepth() {
    return this._matcher.path.length;
  }
  toString(separator, includeNamespace = true) {
    return this._matcher.toString(separator, includeNamespace);
  }
  toArray() {
    return this._matcher.path.map((n) => n.tag);
  }
  matches(expression) {
    return this._matcher.matches(expression);
  }
  matchesAny(exprSet) {
    return exprSet.matchesAny(this._matcher);
  }
}

class Matcher {
  constructor(options = {}) {
    this.separator = options.separator || ".";
    this.path = [];
    this.siblingStacks = [];
    this._pathStringCache = null;
    this._view = new MatcherView(this);
    this._keptAttrs = [];
  }
  push(tagName, attrValues = null, namespace = null, options = null) {
    this._pathStringCache = null;
    if (this.path.length > 0) {
      this.path[this.path.length - 1].values = undefined;
    }
    const currentLevel = this.path.length;
    let level = this.siblingStacks[currentLevel];
    if (!level) {
      level = { counts: new Map, total: 0 };
      this.siblingStacks[currentLevel] = level;
    }
    const siblingKey = namespace ? `${namespace}:${tagName}` : tagName;
    const counter = level.counts.get(siblingKey) || 0;
    const position = level.total;
    level.counts.set(siblingKey, counter + 1);
    level.total++;
    const node = {
      tag: tagName,
      position,
      counter
    };
    if (namespace !== null && namespace !== undefined) {
      node.namespace = namespace;
    }
    if (attrValues !== null && attrValues !== undefined) {
      node.values = attrValues;
    }
    this.path.push(node);
    const depth = this.path.length;
    const keep = options !== null ? options.keep : null;
    if (keep !== null && keep !== undefined && keep.length > 0 && attrValues) {
      for (let i = 0;i < keep.length; i++) {
        const name = keep[i];
        if (attrValues[name] !== undefined) {
          this._keptAttrs.push({ depth, name, value: attrValues[name] });
        }
      }
    }
  }
  pop() {
    if (this.path.length === 0)
      return;
    this._pathStringCache = null;
    const node = this.path.pop();
    if (this.siblingStacks.length > this.path.length + 1) {
      this.siblingStacks.length = this.path.length + 1;
    }
    const poppedDepth = this.path.length + 1;
    while (this._keptAttrs.length > 0 && this._keptAttrs[this._keptAttrs.length - 1].depth >= poppedDepth) {
      this._keptAttrs.pop();
    }
    return node;
  }
  updateCurrent(attrValues) {
    if (this.path.length > 0) {
      const current = this.path[this.path.length - 1];
      if (attrValues !== null && attrValues !== undefined) {
        current.values = attrValues;
      }
    }
  }
  getCurrentTag() {
    return this.path.length > 0 ? this.path[this.path.length - 1].tag : undefined;
  }
  getCurrentNamespace() {
    return this.path.length > 0 ? this.path[this.path.length - 1].namespace : undefined;
  }
  getAttrValue(attrName) {
    if (this.path.length === 0)
      return;
    return this.path[this.path.length - 1].values?.[attrName];
  }
  hasAttr(attrName) {
    if (this.path.length === 0)
      return false;
    const current = this.path[this.path.length - 1];
    return current.values !== undefined && attrName in current.values;
  }
  getAnyParentAttr(attrName) {
    const kept = this._keptAttrs;
    for (let i = kept.length - 1;i >= 0; i--) {
      if (kept[i].name === attrName)
        return kept[i].value;
    }
    return;
  }
  hasAnyParentAttr(attrName) {
    const kept = this._keptAttrs;
    for (let i = kept.length - 1;i >= 0; i--) {
      if (kept[i].name === attrName)
        return true;
    }
    return false;
  }
  getPosition() {
    if (this.path.length === 0)
      return -1;
    return this.path[this.path.length - 1].position ?? 0;
  }
  getCounter() {
    if (this.path.length === 0)
      return -1;
    return this.path[this.path.length - 1].counter ?? 0;
  }
  getIndex() {
    return this.getPosition();
  }
  getDepth() {
    return this.path.length;
  }
  toString(separator, includeNamespace = true) {
    const sep = separator || this.separator;
    const isDefault = sep === this.separator && includeNamespace === true;
    if (isDefault) {
      if (this._pathStringCache !== null) {
        return this._pathStringCache;
      }
      const result = this.path.map((n) => n.namespace ? `${n.namespace}:${n.tag}` : n.tag).join(sep);
      this._pathStringCache = result;
      return result;
    }
    return this.path.map((n) => includeNamespace && n.namespace ? `${n.namespace}:${n.tag}` : n.tag).join(sep);
  }
  toArray() {
    return this.path.map((n) => n.tag);
  }
  reset() {
    this._pathStringCache = null;
    this.path = [];
    this.siblingStacks = [];
    this._keptAttrs = [];
  }
  matches(expression) {
    const segments = expression.segments;
    if (segments.length === 0) {
      return false;
    }
    if (expression.hasDeepWildcard()) {
      return this._matchWithDeepWildcard(segments);
    }
    return this._matchSimple(segments);
  }
  _matchSimple(segments) {
    if (this.path.length !== segments.length) {
      return false;
    }
    for (let i = 0;i < segments.length; i++) {
      if (!this._matchSegment(segments[i], this.path[i], i === this.path.length - 1)) {
        return false;
      }
    }
    return true;
  }
  _matchWithDeepWildcard(segments) {
    let pathIdx = this.path.length - 1;
    let segIdx = segments.length - 1;
    while (segIdx >= 0 && pathIdx >= 0) {
      const segment = segments[segIdx];
      if (segment.type === "deep-wildcard") {
        segIdx--;
        if (segIdx < 0) {
          return true;
        }
        const nextSeg = segments[segIdx];
        let found = false;
        for (let i = pathIdx;i >= 0; i--) {
          if (this._matchSegment(nextSeg, this.path[i], i === this.path.length - 1)) {
            pathIdx = i - 1;
            segIdx--;
            found = true;
            break;
          }
        }
        if (!found) {
          return false;
        }
      } else {
        if (!this._matchSegment(segment, this.path[pathIdx], pathIdx === this.path.length - 1)) {
          return false;
        }
        pathIdx--;
        segIdx--;
      }
    }
    return segIdx < 0;
  }
  _matchSegment(segment, node, isCurrentNode) {
    if (segment.tag !== "*" && segment.tag !== node.tag) {
      return false;
    }
    if (segment.namespace !== undefined) {
      if (segment.namespace !== "*" && segment.namespace !== node.namespace) {
        return false;
      }
    }
    if (segment.attrName !== undefined) {
      if (!isCurrentNode) {
        return false;
      }
      if (!node.values || !(segment.attrName in node.values)) {
        return false;
      }
      if (segment.attrValue !== undefined) {
        if (String(node.values[segment.attrName]) !== String(segment.attrValue)) {
          return false;
        }
      }
    }
    if (segment.position !== undefined) {
      if (!isCurrentNode) {
        return false;
      }
      const counter = node.counter ?? 0;
      if (segment.position === "first" && counter !== 0) {
        return false;
      } else if (segment.position === "odd" && counter % 2 !== 1) {
        return false;
      } else if (segment.position === "even" && counter % 2 !== 0) {
        return false;
      } else if (segment.position === "nth" && counter !== segment.positionValue) {
        return false;
      }
    }
    return true;
  }
  matchesAny(exprSet) {
    return exprSet.matchesAny(this);
  }
  snapshot() {
    return {
      path: this.path.map((node) => ({ ...node })),
      siblingStacks: this.siblingStacks.map((level) => level ? { counts: new Map(level.counts), total: level.total } : level),
      keptAttrs: this._keptAttrs.map((entry) => ({ ...entry }))
    };
  }
  restore(snapshot) {
    this._pathStringCache = null;
    this.path = snapshot.path.map((node) => ({ ...node }));
    this.siblingStacks = snapshot.siblingStacks.map((level) => level ? { counts: new Map(level.counts), total: level.total } : level);
    this._keptAttrs = (snapshot.keptAttrs || []).map((entry) => ({ ...entry }));
  }
  readOnly() {
    return this._view;
  }
}

// ../../node_modules/.bun/is-unsafe@2.0.0/node_modules/is-unsafe/src/contexts/html.js
var HTML_PATTERNS = [
  {
    id: "html-script-open",
    description: "<script opening tag",
    pattern: /<script[\s>/]/i
  },
  {
    id: "html-script-close",
    description: "</script closing tag",
    pattern: /<\/script[\s>]/i
  },
  {
    id: "html-javascript-protocol",
    description: "javascript: URI scheme (with optional whitespace/encoding)",
    pattern: /j[\t\n\r ]*a[\t\n\r ]*v[\t\n\r ]*a[\t\n\r ]*s[\t\n\r ]*c[\t\n\r ]*r[\t\n\r ]*i[\t\n\r ]*p[\t\n\r ]*t[\t\n\r ]*:/i
  },
  {
    id: "html-vbscript-protocol",
    description: "vbscript: URI scheme",
    pattern: /vbscript[\t\n\r ]*:/i
  },
  {
    id: "html-data-html",
    description: "data:text/html URI — can execute scripts in browsers",
    pattern: /data[\t\n\r ]*:[\t\n\r ]*text\/html/i
  },
  {
    id: "html-data-xhtml",
    description: "data:application/xhtml+xml URI",
    pattern: /data[\t\n\r ]*:[\t\n\r ]*application\/xhtml/i
  },
  {
    id: "html-data-svg",
    description: "data:image/svg+xml URI — can execute scripts",
    pattern: /data[\t\n\r ]*:[\t\n\r ]*image\/svg\+xml/i
  },
  {
    id: "html-inline-event-handler",
    description: "Inline event handler attributes: onclick=, onerror=, onload=, etc.",
    pattern: /\bon\w{1,30}\s*=/i
  },
  {
    id: "html-entity-obfuscated-script",
    description: "HTML-entity-encoded <script (e.g. &#x3C;script or &lt;script)",
    pattern: /(?:&#x0*3[Cc];?|&#0*60;?|&lt;)\s*script/i
  },
  {
    id: "html-entity-obfuscated-javascript",
    description: 'HTML-entity-encoded javascript: (partial — catches common &#106; or &#x6a; for "j")',
    pattern: /(?:&#x0*6[Aa];?|&#0*106;?)\s*(?:&#x0*61;?|a)[\s\S]{0,80}script\s*:/i
  },
  {
    id: "html-style-expression",
    description: "CSS expression() — IE-era code execution in style attributes",
    pattern: /style[\s\S]{0,20}expression\s*\(/i
  },
  {
    id: "html-object-embed",
    description: "<object or <embed tags that can load active content",
    pattern: /<(?:object|embed)[\s>/]/i
  },
  {
    id: "html-base-tag",
    description: "<base href= — can hijack all relative URLs on a page",
    pattern: /<base[\s>]/i
  },
  {
    id: "html-meta-refresh",
    description: '<meta http-equiv="refresh" — can redirect users',
    pattern: /<meta[\s\S]{0,40}http-equiv[\s\S]{0,20}refresh/i
  },
  {
    id: "html-srcdoc",
    description: "srcdoc= attribute on iframes — embeds HTML that can run scripts",
    pattern: /srcdoc\s*=/i
  },
  {
    id: "html-iframe",
    description: "<iframe tag",
    pattern: /<iframe[\s>/]/i
  },
  {
    id: "html-form",
    description: "<form tag — can be used for phishing / credential harvesting injection",
    pattern: /<form[\s>/]/i
  }
];
var html_default = HTML_PATTERNS;
// ../../node_modules/.bun/is-unsafe@2.0.0/node_modules/is-unsafe/src/contexts/xml.js
var XML_PATTERNS = [
  {
    id: "xml-cdata-injection",
    description: "CDATA section injection: <![CDATA[ breaks out of text node context",
    pattern: /<!\[CDATA\[/i
  },
  {
    id: "xml-cdata-close",
    description: "CDATA close sequence: ]]> can terminate an enclosing CDATA section",
    pattern: /\]\]>/
  },
  {
    id: "xml-processing-instruction",
    description: "XML processing instruction: <?xml-stylesheet or <?php etc.",
    pattern: /<\?(?:xml[\- ]|php|asp)/i
  },
  {
    id: "xml-doctype-injection",
    description: "DOCTYPE declaration embedded in content — can define entities",
    pattern: /<!DOCTYPE(?:[\s[]|$)/i
  },
  {
    id: "xml-entity-system",
    description: "SYSTEM keyword — used in external entity declarations (XXE)",
    pattern: /\bSYSTEM\s+["']/i
  },
  {
    id: "xml-entity-public",
    description: "PUBLIC keyword — used in external entity declarations (XXE)",
    pattern: /\bPUBLIC\s+["']/i
  },
  {
    id: "xml-entity-declaration",
    description: "<!ENTITY declaration — defines entities, potential XXE or entity expansion",
    pattern: /<!ENTITY[\s%]/i
  },
  {
    id: "xml-billion-laughs",
    description: "Entity reference chaining / billion laughs: repeated &eX; style references",
    pattern: /(?:&\w{1,20};){3,}/
  },
  {
    id: "xml-namespace-confusion",
    description: "xmlns: attribute injection — can redefine namespaces to confuse parsers",
    pattern: /\bxmlns\s*(?::\w{1,40})?\s*=/i
  },
  {
    id: "xml-comment-injection",
    description: "<!-- comment injection — can hide content from some parsers",
    pattern: /<!--/
  },
  {
    id: "xml-comment-close",
    description: "--> closes an enclosing XML comment",
    pattern: /-->/
  },
  {
    id: "xml-pi-close",
    description: "?> closes an enclosing processing instruction",
    pattern: /\?>/
  }
];
var xml_default = XML_PATTERNS;
// ../../node_modules/.bun/is-unsafe@2.0.0/node_modules/is-unsafe/src/contexts/svg.js
var SVG_PATTERNS = [
  {
    id: "svg-script-element",
    description: "<script element inside SVG executes JavaScript",
    pattern: /<script[\s>/]/i
  },
  {
    id: "svg-xlink-href-javascript",
    description: "xlink:href with javascript: — classic SVG XSS via <a> or <use>",
    pattern: /xlink\s*:\s*href\s*=\s*["']?\s*javascript\s*:/i
  },
  {
    id: "svg-href-javascript",
    description: "href= with javascript: in SVG context (<a>, <animate>, etc.)",
    pattern: /href\s*=\s*["']?\s*javascript\s*:/i
  },
  {
    id: "svg-foreignobject",
    description: "<foreignObject embeds HTML inside SVG — can execute scripts",
    pattern: /<foreignObject[\s>/]/i
  },
  {
    id: "svg-use-external",
    description: "<use xlink:href or href pointing to external resource (non-fragment URL)",
    pattern: /<use[\s\S]{0,60}(?:xlink\s*:\s*)?href\s*=\s*(?:["'][^#]|[^"'#\s>])/i
  },
  {
    id: "svg-animate-href",
    description: '<animate attributeName="href" — can dynamically change href to javascript:',
    pattern: /<animate[\s\S]{0,80}attributeName\s*=\s*["'][\s]*href["']/i
  },
  {
    id: "svg-animate-xlinkhref",
    description: '<animate attributeName="xlink:href"',
    pattern: /<animate[\s\S]{0,80}attributeName\s*=\s*["'][\s]*xlink\s*:\s*href["']/i
  },
  {
    id: "svg-set-javascript",
    description: '<set to="javascript:..." — sets an attribute to a javascript: URI',
    pattern: /<set[\s\S]{0,80}to\s*=\s*["']?\s*javascript\s*:/i
  },
  {
    id: "svg-event-handler",
    description: "SVG-specific event handler attributes: onload=, onerror=, onactivate=, etc.",
    pattern: /\bon(?:load|error|activate|begin|end|repeat|focus|blur|click|mouse\w{1,20}|key\w{1,20})\s*=/i
  },
  {
    id: "svg-handler-generic",
    description: "Generic on* handler catch-all for SVG attributes",
    pattern: /\bon\w{1,30}\s*=/i
  },
  {
    id: "svg-filter-feimage",
    description: "<feImage href= — filter primitive that can load external resources",
    pattern: /<feImage[\s\S]{0,80}(?:xlink\s*:\s*)?href\s*=/i
  },
  {
    id: "svg-image-external",
    description: "<image xlink:href with http/https or javascript protocol",
    pattern: /<image[\s\S]{0,80}(?:xlink\s*:\s*)?href\s*=\s*["']?\s*(?:https?|javascript)\s*:/i
  },
  {
    id: "svg-style-javascript",
    description: "style= attribute containing javascript: (e.g. background:url(javascript:...))",
    pattern: /style\s*=[\s\S]{0,60}javascript\s*:/i
  }
];
var svg_default = SVG_PATTERNS;

// ../../node_modules/.bun/is-unsafe@2.0.0/node_modules/is-unsafe/src/contexts/sql.js
var SQL_PATTERNS = [
  {
    id: "sql-block-comment-open",
    description: "SQL block comment open: /* ... */ — unusual in legitimate user text",
    pattern: /\/\*/
  },
  {
    id: "sql-union-select",
    description: "UNION SELECT — most common SQL injection aggregation attack",
    pattern: /\bUNION\s{1,20}(?:ALL\s{1,20})?SELECT\b/i
  },
  {
    id: "sql-drop-table",
    description: "DROP TABLE — destructive DDL injection",
    pattern: /\bDROP\s{1,20}TABLE\b/i
  },
  {
    id: "sql-drop-database",
    description: "DROP DATABASE — destructive DDL injection",
    pattern: /\bDROP\s{1,20}DATABASE\b/i
  },
  {
    id: "sql-insert-into",
    description: "INSERT INTO — data injection",
    pattern: /\bINSERT\s{1,20}INTO\b/i
  },
  {
    id: "sql-delete-from",
    description: "DELETE FROM — data deletion injection",
    pattern: /\bDELETE\s{1,20}FROM\b/i
  },
  {
    id: "sql-update-set",
    description: "UPDATE ... SET — data modification injection",
    pattern: /\bUPDATE\b[\s\S]{1,60}\bSET\b/i
  },
  {
    id: "sql-exec-xp",
    description: "EXEC xp_ — MSSQL extended stored procedure execution",
    pattern: /\bEXEC(?:UTE)?\s{1,20}xp_/i
  },
  {
    id: "sql-tautology-string",
    description: `Classic string tautology: ' OR '1'='1 or " OR "1"="1"`,
    pattern: /'\s{0,10}OR\s{0,10}'[^']{0,20}'\s*=\s*'[^']{0,20}/i
  },
  {
    id: "sql-tautology-numeric",
    description: "Numeric tautology: OR 1=1",
    pattern: /\bOR\s{1,10}1\s*=\s*1\b/i
  },
  {
    id: "sql-always-true-zero",
    description: "Numeric tautology: OR 0=0",
    pattern: /\bOR\s{1,10}0\s*=\s*0\b/i
  },
  {
    id: "sql-sleep-benchmark",
    description: "Time-based blind injection: SLEEP() or BENCHMARK()",
    pattern: /\b(?:SLEEP|BENCHMARK)\s*\(/i
  },
  {
    id: "sql-waitfor-delay",
    description: "MSSQL time-based blind injection: WAITFOR DELAY",
    pattern: /\bWAITFOR\s{1,20}DELAY\b/i
  },
  {
    id: "sql-char-function",
    description: "CHAR() function — used to obfuscate injected strings",
    pattern: /\bCHAR\s*\(\s*\d{1,3}/i
  },
  {
    id: "sql-information-schema",
    description: "INFORMATION_SCHEMA — reconnaissance query for table/column enumeration",
    pattern: /\bINFORMATION_SCHEMA\b/i
  }
];
var sql_default = SQL_PATTERNS;

// ../../node_modules/.bun/is-unsafe@2.0.0/node_modules/is-unsafe/src/contexts/shell.js
var SHELL_PATTERNS = [
  {
    id: "shell-path-traversal-unix",
    description: "Unix path traversal: ../  — climbing the directory tree",
    pattern: /\.\.\//
  },
  {
    id: "shell-path-traversal-windows",
    description: "Windows path traversal: ..\\ — climbing the directory tree",
    pattern: /\.\.\\/
  },
  {
    id: "shell-path-traversal-encoded",
    description: "URL-encoded path traversal: %2e%2e or %2f variants",
    pattern: /%2e%2e|%2f\.\.|\.\.%2f/i
  },
  {
    id: "shell-null-byte",
    description: "Null byte injection: \\x00 or %00 — truncates strings in C-backed functions",
    pattern: /\x00|%00/
  },
  {
    id: "shell-semicolon",
    description: "Semicolon command separator: cmd1; cmd2",
    pattern: /;/
  },
  {
    id: "shell-pipe",
    description: "Pipe operator: cmd1 | cmd2",
    pattern: /\|/
  },
  {
    id: "shell-and-operator",
    description: "AND operator: cmd1 && cmd2",
    pattern: /&&/
  },
  {
    id: "shell-or-operator",
    description: "OR operator: cmd1 || cmd2",
    pattern: /\|\|/
  },
  {
    id: "shell-backtick",
    description: "Backtick command substitution: `cmd`",
    pattern: /`/
  },
  {
    id: "shell-dollar-paren",
    description: "Dollar-paren command substitution: $(cmd)",
    pattern: /\$\(/
  },
  {
    id: "shell-dollar-brace",
    description: "Dollar-brace variable expansion: ${var} — can be abused for injection",
    pattern: /\$\{/
  },
  {
    id: "shell-redirect-out",
    description: "Output redirection: cmd > file or cmd >> file",
    pattern: />{1,2}/
  },
  {
    id: "shell-redirect-in",
    description: "Input redirection: cmd < file",
    pattern: /</
  },
  {
    id: "shell-newline-injection",
    description: "Newline injection: \\n or \\r — can inject new shell commands",
    pattern: /[\n\r]/
  },
  {
    id: "shell-glob-star",
    description: "Glob expansion: * or ? — can expand to unintended files",
    pattern: /[/\\][*?]/
  },
  {
    id: "shell-absolute-root",
    description: "Absolute root path injection: string starting with / or \\ (Windows UNC)",
    pattern: /^(?:\/|\\\\)/
  },
  {
    id: "shell-windows-drive",
    description: "Windows drive letter path injection: C:\\ or D:/",
    pattern: /^[a-zA-Z]:[/\\]/
  },
  {
    id: "shell-curl-wget",
    description: "curl/wget with URL or flags — can exfiltrate data or download payloads",
    pattern: /\b(?:curl|wget)\s+(?:https?:\/\/|ftp:\/\/|-)/i
  }
];
var shell_default = SHELL_PATTERNS;

// ../../node_modules/.bun/is-unsafe@2.0.0/node_modules/is-unsafe/src/contexts/redos.js
var REDOS_PATTERNS = [
  {
    id: "redos-nested-quantifier-plus",
    description: "Nested + quantifier inside a group with outer quantifier: (a+)+, (.+b)*, etc.",
    pattern: /\([^)]*\+[^)]*\)[+*]/
  },
  {
    id: "redos-nested-quantifier-star",
    description: "Nested * quantifier: (a*)* or (a*)+ — catastrophic backtracking",
    pattern: /\([^)]*\*[^)]*\)[*+]/
  },
  {
    id: "redos-nested-groups",
    description: "Doubly nested quantified groups: ((a+)+) — guaranteed catastrophic",
    pattern: /\(\([^)]{0,40}\)[+*]\)[+*]/
  },
  {
    id: "redos-alternation-overlap",
    description: "Overlapping alternation under quantifier: (a|a)+ — ambiguous NFA paths",
    pattern: /\(([^|()]{1,20})\|(?:\1)(?:\|[^|()]{1,20}){0,5}\)[+*?]{1,2}/
  },
  {
    id: "redos-star-plus-concat",
    description: "(x*x)+ pattern — triggers super-linear backtracking",
    pattern: /\([^)]{0,10}\*[^)]{0,10}\)[+*]/
  },
  {
    id: "redos-dot-star-greedy",
    description: "(.*){n,} or (.+){n,} — repeated greedy dot quantifiers",
    pattern: /\(\.[*+]\)\{?\d/
  },
  {
    id: "redos-large-repetition",
    description: "Very large fixed or range repetition count {1000,} or {1000,n} — denial of service via backtracking",
    pattern: /\{\d{4,}(?:,\d*)?\}/
  },
  {
    id: "redos-catastrophic-alternation",
    description: "Long alternation with many similar branches — polynomial backtracking risk",
    pattern: /\([^)]{0,200}(?:\|[^|)]{0,50}){9,}\)/
  }
];
var redos_default = REDOS_PATTERNS;

// ../../node_modules/.bun/is-unsafe@2.0.0/node_modules/is-unsafe/src/contexts/nosql.js
var sep = `["'\\s]*:`;
var NOSQL_PATTERNS = [
  {
    id: "nosql-where-operator",
    description: "$where — executes arbitrary JavaScript server-side in MongoDB",
    pattern: new RegExp(`\\$where${sep}`, "i")
  },
  {
    id: "nosql-ne-operator",
    description: '$ne — "not equal" operator used to bypass equality checks',
    pattern: new RegExp(`\\$ne${sep}`, "i")
  },
  {
    id: "nosql-gt-operator",
    description: '$gt — "greater than" used to bypass password/value checks',
    pattern: new RegExp(`\\$gte?${sep}`, "i")
  },
  {
    id: "nosql-lt-operator",
    description: '$lt / $lte — "less than" bypass variants',
    pattern: new RegExp(`\\$lte?${sep}`, "i")
  },
  {
    id: "nosql-regex-operator",
    description: "$regex — can be used to extract data character by character (blind injection)",
    pattern: new RegExp(`\\$regex${sep}`, "i")
  },
  {
    id: "nosql-or-operator",
    description: "$or — logical OR; used to create always-true conditions",
    pattern: new RegExp(`\\$or${sep}\\s*\\[`, "i")
  },
  {
    id: "nosql-and-operator",
    description: "$and — logical AND operator injection",
    pattern: new RegExp(`\\$and${sep}\\s*\\[`, "i")
  },
  {
    id: "nosql-nor-operator",
    description: "$nor — logical NOR operator injection",
    pattern: new RegExp(`\\$nor${sep}\\s*\\[`, "i")
  },
  {
    id: "nosql-exists-operator",
    description: "$exists — can enumerate fields to determine schema",
    pattern: new RegExp(`\\$exists${sep}`, "i")
  },
  {
    id: "nosql-in-operator",
    description: "$in — matches any value in a list; can enumerate values",
    pattern: new RegExp(`\\$in${sep}\\s*\\[`, "i")
  },
  {
    id: "nosql-expr-operator",
    description: "$expr — allows aggregation expressions in queries (MongoDB 3.6+)",
    pattern: new RegExp(`\\$expr${sep}`, "i")
  },
  {
    id: "nosql-function-operator",
    description: "$function — executes arbitrary JavaScript in MongoDB 4.4+",
    pattern: new RegExp(`\\$function${sep}`, "i")
  },
  {
    id: "nosql-accumulator-operator",
    description: "$accumulator — custom aggregation with arbitrary JS execution",
    pattern: new RegExp(`\\$accumulator${sep}`, "i")
  },
  {
    id: "nosql-proto-pollution",
    description: "__proto__ — prototype pollution via object key injection",
    pattern: /__proto__/
  },
  {
    id: "nosql-constructor-prototype",
    description: "constructor.prototype — alternative prototype pollution vector (dot notation or JSON key)",
    pattern: /constructor[\s"':.,{\[]*prototype/i
  },
  {
    id: "nosql-proto-bracket",
    description: '["__proto__"] — bracket-notation prototype pollution',
    pattern: /\[["']__proto__["']\]/
  }
];
var nosql_default = NOSQL_PATTERNS;

// ../../node_modules/.bun/is-unsafe@2.0.0/node_modules/is-unsafe/src/contexts/log.js
var LOG_PATTERNS = [
  {
    id: "log-crlf-injection",
    description: "CRLF injection: literal \\r or \\n embeds fake log lines",
    pattern: /[\r\n]/
  },
  {
    id: "log-url-encoded-crlf",
    description: "URL-encoded CRLF: %0d, %0a, %0D, %0A — decoded by some log parsers",
    pattern: /%0[dDaA]/
  },
  {
    id: "log-unicode-newline",
    description: "Unicode newline variants: U+2028 (line separator), U+2029 (paragraph separator)",
    pattern: /[\u2028\u2029]/
  },
  {
    id: "log-log4shell-jndi",
    description: "Log4Shell: ${jndi:...} triggers remote code execution in Apache Log4j",
    pattern: /\$\{jndi\s*:/i
  },
  {
    id: "log-log4shell-obfuscated",
    description: "Obfuscated Log4Shell: ${::-j}... lookup-bypass prefix used to evade WAF detection",
    pattern: /\$\{::-/
  },
  {
    id: "log-log4j-lookup",
    description: "Log4j lookup syntax: ${env:...}, ${sys:...}, ${ctx:...} — data exfiltration",
    pattern: /\$\{(?:env|sys|ctx|main|map|sd|web|docker|k8s|spring)\s*:/i
  },
  {
    id: "log-ssti-double-brace",
    description: "SSTI double-brace: {{expression}} — Jinja2, Twig, Handlebars, etc.",
    pattern: /\{\{[\s\S]{0,80}\}\}/
  },
  {
    id: "log-ssti-hash-brace",
    description: "SSTI hash-brace: #{expression} — Thymeleaf, Velocity, Ruby ERB",
    pattern: /#\{[\s\S]{0,80}\}/
  },
  {
    id: "log-ssti-dollar-brace",
    description: "SSTI/EL injection: ${expression with operators or method calls} — JSP EL, Freemarker, SpEL",
    pattern: /\$\{[^}]*(?:\.|\(|\*|\+|\bclass\b|\bruntime\b|\bprocess\b|\bexec\b)[^}]{0,80}\}/i
  },
  {
    id: "log-ssti-percent-tag",
    description: "SSTI ERB/ASP tag: <%= expression %> — Ruby ERB, ASP",
    pattern: /<%=[\s\S]{0,80}%>/
  },
  {
    id: "log-null-byte",
    description: "Null byte: \\x00 or %00 — can truncate log entries in C-backed loggers",
    pattern: /\x00|%00/
  },
  {
    id: "log-ansi-escape",
    description: "ANSI escape sequence: ESC[ — can manipulate terminal output when logs are tailed",
    pattern: /\x1b\[/
  }
];
var log_default = LOG_PATTERNS;

// ../../node_modules/.bun/is-unsafe@2.0.0/node_modules/is-unsafe/src/contexts/sql-strict.js
var SQL_STRICT_EXTRA = [
  {
    id: "sql-line-comment",
    description: "SQL line comment: -- followed by whitespace or end of string",
    pattern: /--(?:\s|$)/
  },
  {
    id: "sql-stacked-query",
    description: "Stacked queries: semicolon immediately followed by a SQL keyword",
    pattern: /;\s{0,10}(?:SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC)\b/i
  },
  {
    id: "sql-hex-encoding",
    description: "Hex-encoded string injection: 0x41414141 style (MySQL)",
    pattern: /\b0x[0-9a-f]{4,}/i
  }
];
var SQL_STRICT_PATTERNS = [...sql_default, ...SQL_STRICT_EXTRA];
var sql_strict_default = SQL_STRICT_PATTERNS;

// ../../node_modules/.bun/is-unsafe@2.0.0/node_modules/is-unsafe/src/index.js
html_default.label = "HTML";
xml_default.label = "XML";
svg_default.label = "SVG";
sql_default.label = "SQL";
sql_strict_default.label = "SQL-STRICT";
shell_default.label = "SHELL";
redos_default.label = "REDOS";
nosql_default.label = "NOSQL";
log_default.label = "LOG";
var VALID_CONTEXTS = Object.freeze({
  HTML: html_default,
  XML: xml_default,
  SVG: svg_default,
  SQL: sql_default,
  "SQL-STRICT": sql_strict_default,
  SHELL: shell_default,
  REDOS: redos_default,
  NOSQL: nosql_default,
  LOG: log_default
});
function assertString(value) {
  if (typeof value !== "string") {
    throw new TypeError(`is-unsafe: first argument must be a string, got ${typeof value}`);
  }
}
function assertContext(context) {
  if (context instanceof RegExp)
    return;
  if (Array.isArray(context)) {
    if (context.length === 0) {
      throw new TypeError("is-unsafe: context must not be an empty array");
    }
    if (Array.isArray(context[0])) {
      for (const list of context) {
        if (!Array.isArray(list) || list.length === 0) {
          throw new TypeError("is-unsafe: each context in the array must be a non-empty pattern array (PatternList)");
        }
      }
    }
    return;
  }
  throw new TypeError(`is-unsafe: second argument must be a PatternList (e.g. HTML), ` + `an array of PatternLists (e.g. [HTML, XML]), or a RegExp. Got: ${typeof context}`);
}
function normalise(context) {
  if (context instanceof RegExp)
    return { lists: null, regex: context };
  if (Array.isArray(context[0]))
    return { lists: context, regex: null };
  return { lists: [context], regex: null };
}
function matchList(value, list) {
  const label = list.label ?? "CUSTOM";
  for (const rule of list) {
    if (rule.pattern.test(value)) {
      return { context: label, id: rule.id, description: rule.description, pattern: rule.pattern };
    }
  }
  return null;
}
function isUnsafe(value, context) {
  assertString(value);
  assertContext(context);
  const { lists, regex } = normalise(context);
  if (regex)
    return regex.test(value);
  for (const list of lists) {
    if (matchList(value, list) !== null)
      return true;
  }
  return false;
}

// ../../node_modules/.bun/fast-xml-parser@5.10.1/node_modules/fast-xml-parser/src/xmlparser/OrderedObjParser.js
function extractRawAttributes(prefixedAttrs, options) {
  if (!prefixedAttrs)
    return {};
  const attrs = options.attributesGroupName ? prefixedAttrs[options.attributesGroupName] : prefixedAttrs;
  if (!attrs)
    return {};
  const rawAttrs = {};
  for (const key in attrs) {
    if (key.startsWith(options.attributeNamePrefix)) {
      const rawName = key.substring(options.attributeNamePrefix.length);
      rawAttrs[rawName] = attrs[key];
    } else {
      rawAttrs[key] = attrs[key];
    }
  }
  return rawAttrs;
}
function extractNamespace(rawTagName) {
  if (!rawTagName || typeof rawTagName !== "string")
    return;
  const colonIndex = rawTagName.indexOf(":");
  if (colonIndex !== -1 && colonIndex > 0) {
    const ns = rawTagName.substring(0, colonIndex);
    if (ns !== "xmlns") {
      return ns;
    }
  }
  return;
}

class OrderedObjParser {
  constructor(options, externalEntities) {
    this.options = options;
    this.currentNode = null;
    this.tagsNodeStack = [];
    this.parseXml = parseXml;
    this.parseTextData = parseTextData;
    this.resolveNameSpace = resolveNameSpace;
    this.buildAttributesMap = buildAttributesMap;
    this.isItStopNode = isItStopNode;
    this.replaceEntitiesValue = replaceEntitiesValue;
    this.readStopNodeData = readStopNodeData;
    this.saveTextToParentTag = saveTextToParentTag;
    this.addChild = addChild;
    this.ignoreAttributesFn = getIgnoreAttributesFn(this.options.ignoreAttributes);
    this.entityExpansionCount = 0;
    this.currentExpandedLength = 0;
    this.doctypefound = false;
    let namedEntities = { ...XML };
    if (this.options.entityDecoder) {
      this.entityDecoder = this.options.entityDecoder;
    } else {
      if (typeof this.options.htmlEntities === "object")
        namedEntities = this.options.htmlEntities;
      else if (this.options.htmlEntities === true)
        namedEntities = { ...COMMON_HTML, ...CURRENCY };
      this.entityDecoder = new EntityDecoder({
        namedEntities: { ...namedEntities, ...externalEntities },
        numericAllowed: this.options.htmlEntities,
        limit: {
          maxTotalExpansions: this.options.processEntities.maxTotalExpansions,
          maxExpandedLength: this.options.processEntities.maxExpandedLength,
          applyLimitsTo: this.options.processEntities.appliesTo
        },
        onInputEntity: (name, value) => isUnsafe(value, [html_default, xml_default]) ? ENTITY_ACTION.BLOCK : ENTITY_ACTION.ALLOW
      });
    }
    this.matcher = new Matcher;
    this.readonlyMatcher = this.matcher.readOnly();
    this.isCurrentNodeStopNode = false;
    this.stopNodeExpressionsSet = new ExpressionSet;
    const stopNodesOpts = this.options.stopNodes;
    if (stopNodesOpts && stopNodesOpts.length > 0) {
      for (let i = 0;i < stopNodesOpts.length; i++) {
        const stopNodeExp = stopNodesOpts[i];
        if (typeof stopNodeExp === "string") {
          this.stopNodeExpressionsSet.add(new Expression(stopNodeExp));
        } else if (stopNodeExp instanceof Expression) {
          this.stopNodeExpressionsSet.add(stopNodeExp);
        }
      }
      this.stopNodeExpressionsSet.seal();
    }
  }
}
function parseTextData(val, tagName, jPath, dontTrim, hasAttributes, isLeafNode, escapeEntities) {
  const options = this.options;
  if (val !== undefined) {
    if (options.trimValues && !dontTrim) {
      val = val.trim();
    }
    if (val.length > 0) {
      if (!escapeEntities)
        val = this.replaceEntitiesValue(val, tagName, jPath);
      const jPathOrMatcher = options.jPath ? jPath.toString() : jPath;
      const newval = options.tagValueProcessor(tagName, val, jPathOrMatcher, hasAttributes, isLeafNode);
      if (newval === null || newval === undefined) {
        return val;
      } else if (typeof newval !== typeof val || newval !== val) {
        return newval;
      } else if (options.trimValues) {
        return parseValue(val, options.parseTagValue, options.numberParseOptions);
      } else {
        const trimmedVal = val.trim();
        if (trimmedVal === val) {
          return parseValue(val, options.parseTagValue, options.numberParseOptions);
        } else {
          return val;
        }
      }
    }
  }
}
function resolveNameSpace(tagname) {
  if (this.options.removeNSPrefix) {
    const tags = tagname.split(":");
    const prefix = tagname.charAt(0) === "/" ? "/" : "";
    if (tags[0] === "xmlns") {
      return "";
    }
    if (tags.length === 2) {
      tagname = prefix + tags[1];
    }
  }
  return tagname;
}
var attrsRegx = new RegExp(`([^\\s=]+)\\s*(=\\s*(['"])([\\s\\S]*?)\\3)?`, "gm");
function buildAttributesMap(attrStr, jPath, tagName, force = false) {
  const options = this.options;
  if (force === true || options.ignoreAttributes !== true && typeof attrStr === "string") {
    const matches = getAllMatches(attrStr, attrsRegx);
    const len = matches.length;
    const attrs = {};
    const processedVals = new Array(len);
    let hasRawAttrs = false;
    const rawAttrsForMatcher = {};
    for (let i = 0;i < len; i++) {
      const attrName = this.resolveNameSpace(matches[i][1]);
      const oldVal = matches[i][4];
      if (attrName.length && oldVal !== undefined) {
        let val = oldVal;
        if (options.trimValues)
          val = val.trim();
        val = this.replaceEntitiesValue(val, tagName, this.readonlyMatcher);
        processedVals[i] = val;
        rawAttrsForMatcher[attrName] = val;
        hasRawAttrs = true;
      }
    }
    if (hasRawAttrs && typeof jPath === "object" && jPath.updateCurrent) {
      jPath.updateCurrent(rawAttrsForMatcher);
    }
    const jPathStr = options.jPath ? jPath.toString() : this.readonlyMatcher;
    let hasAttrs = false;
    for (let i = 0;i < len; i++) {
      const attrName = this.resolveNameSpace(matches[i][1]);
      if (this.ignoreAttributesFn(attrName, jPathStr))
        continue;
      let aName = options.attributeNamePrefix + attrName;
      if (attrName.length) {
        if (options.transformAttributeName) {
          aName = options.transformAttributeName(aName);
        }
        aName = sanitizeName(aName, options);
        if (matches[i][4] !== undefined) {
          const oldVal = processedVals[i];
          const newVal = options.attributeValueProcessor(attrName, oldVal, jPathStr);
          if (newVal === null || newVal === undefined) {
            attrs[aName] = oldVal;
          } else if (typeof newVal !== typeof oldVal || newVal !== oldVal) {
            attrs[aName] = newVal;
          } else {
            attrs[aName] = parseValue(oldVal, options.parseAttributeValue, options.numberParseOptions);
          }
          hasAttrs = true;
        } else if (options.allowBooleanAttributes) {
          attrs[aName] = true;
          hasAttrs = true;
        }
      }
    }
    if (!hasAttrs)
      return;
    if (options.attributesGroupName && !options.preserveOrder) {
      const attrCollection = {};
      attrCollection[options.attributesGroupName] = attrs;
      return attrCollection;
    }
    return attrs;
  }
}
var parseXml = function(xmlData) {
  xmlData = xmlData.replace(/\r\n?/g, `
`);
  const xmlObj = new XmlNode("!xml");
  let currentNode = xmlObj;
  let textData = "";
  this.matcher.reset();
  this.entityDecoder.reset();
  this.entityExpansionCount = 0;
  this.currentExpandedLength = 0;
  this.doctypefound = false;
  const options = this.options;
  const docTypeReader = new DocTypeReader(options.processEntities);
  const xmlLen = xmlData.length;
  for (let i = 0;i < xmlLen; i++) {
    const ch = xmlData[i];
    if (ch === "<") {
      const c1 = xmlData.charCodeAt(i + 1);
      if (c1 === 47) {
        const closeIndex = findClosingIndex(xmlData, ">", i, "Closing Tag is not closed.");
        let tagName = xmlData.substring(i + 2, closeIndex).trim();
        if (options.removeNSPrefix) {
          const colonIndex = tagName.indexOf(":");
          if (colonIndex !== -1) {
            tagName = tagName.substr(colonIndex + 1);
          }
        }
        tagName = transformTagName(options.transformTagName, tagName, "", options).tagName;
        if (currentNode) {
          textData = this.saveTextToParentTag(textData, currentNode, this.readonlyMatcher);
        }
        const lastTagName = this.matcher.getCurrentTag();
        if (tagName && options.unpairedTagsSet.has(tagName)) {
          throw new Error(`Unpaired tag can not be used as closing tag: </${tagName}>`);
        }
        if (lastTagName && options.unpairedTagsSet.has(lastTagName)) {
          this.matcher.pop();
          this.tagsNodeStack.pop();
        }
        this.matcher.pop();
        this.isCurrentNodeStopNode = false;
        currentNode = this.tagsNodeStack.pop();
        textData = "";
        i = closeIndex;
      } else if (c1 === 63) {
        let tagData = readTagExp(xmlData, i, false, "?>");
        if (!tagData)
          throw new Error("Pi Tag is not closed.");
        textData = this.saveTextToParentTag(textData, currentNode, this.readonlyMatcher);
        const attsMap = this.buildAttributesMap(tagData.tagExp, this.matcher, tagData.tagName, true);
        if (attsMap) {
          const ver = attsMap[this.options.attributeNamePrefix + "version"];
          this.entityDecoder.setXmlVersion(Number(ver) || 1);
          docTypeReader.setXmlVersion(Number(ver) || 1);
        }
        if (options.ignoreDeclaration && tagData.tagName === "?xml" || options.ignorePiTags) {} else {
          const childNode = new XmlNode(tagData.tagName);
          childNode.add(options.textNodeName, "");
          if (tagData.tagName !== tagData.tagExp && tagData.attrExpPresent && options.ignoreAttributes !== true) {
            childNode[":@"] = attsMap;
          }
          this.addChild(currentNode, childNode, this.readonlyMatcher, i);
        }
        i = tagData.closeIndex + 1;
      } else if (c1 === 33 && xmlData.charCodeAt(i + 2) === 45 && xmlData.charCodeAt(i + 3) === 45) {
        const endIndex = findClosingIndex(xmlData, "-->", i + 4, "Comment is not closed.");
        if (options.commentPropName) {
          const comment = xmlData.substring(i + 4, endIndex - 2);
          textData = this.saveTextToParentTag(textData, currentNode, this.readonlyMatcher);
          currentNode.add(options.commentPropName, [{ [options.textNodeName]: comment }]);
        }
        i = endIndex;
      } else if (c1 === 33 && xmlData.charCodeAt(i + 2) === 68) {
        if (this.doctypefound)
          throw new Error("Multiple DOCTYPE declarations found.");
        this.doctypefound = true;
        const result = docTypeReader.readDocType(xmlData, i);
        this.entityDecoder.addInputEntities(result.entities);
        i = result.i;
      } else if (c1 === 33 && xmlData.charCodeAt(i + 2) === 91) {
        const closeIndex = findClosingIndex(xmlData, "]]>", i, "CDATA is not closed.") - 2;
        const tagExp = xmlData.substring(i + 9, closeIndex);
        textData = this.saveTextToParentTag(textData, currentNode, this.readonlyMatcher);
        let val = this.parseTextData(tagExp, currentNode.tagname, this.readonlyMatcher, true, false, true, true);
        if (val == undefined)
          val = "";
        if (options.cdataPropName) {
          currentNode.add(options.cdataPropName, [{ [options.textNodeName]: tagExp }]);
        } else {
          currentNode.add(options.textNodeName, val);
        }
        i = closeIndex + 2;
      } else {
        let result = readTagExp(xmlData, i, options.removeNSPrefix);
        if (!result) {
          const context = xmlData.substring(Math.max(0, i - 50), Math.min(xmlLen, i + 50));
          throw new Error(`readTagExp returned undefined at position ${i}. Context: "${context}"`);
        }
        let tagName = result.tagName;
        const rawTagName = result.rawTagName;
        let tagExp = result.tagExp;
        let attrExpPresent = result.attrExpPresent;
        let closeIndex = result.closeIndex;
        ({ tagName, tagExp } = transformTagName(options.transformTagName, tagName, tagExp, options));
        if (options.strictReservedNames && (tagName === options.commentPropName || tagName === options.cdataPropName || tagName === options.textNodeName || tagName === options.attributesGroupName)) {
          throw new Error(`Invalid tag name: ${tagName}`);
        }
        if (currentNode && textData) {
          if (currentNode.tagname !== "!xml") {
            textData = this.saveTextToParentTag(textData, currentNode, this.readonlyMatcher, false);
          }
        }
        const lastTag = currentNode;
        if (lastTag && options.unpairedTagsSet.has(lastTag.tagname)) {
          currentNode = this.tagsNodeStack.pop();
          this.matcher.pop();
        }
        let isSelfClosing = false;
        if (tagExp.length > 0 && tagExp.lastIndexOf("/") === tagExp.length - 1) {
          isSelfClosing = true;
          if (tagName[tagName.length - 1] === "/") {
            tagName = tagName.substr(0, tagName.length - 1);
            tagExp = tagName;
          } else {
            tagExp = tagExp.substr(0, tagExp.length - 1);
          }
          attrExpPresent = tagName !== tagExp;
        }
        let prefixedAttrs = null;
        let rawAttrs = {};
        let namespace = undefined;
        namespace = extractNamespace(rawTagName);
        if (tagName !== xmlObj.tagname) {
          this.matcher.push(tagName, {}, namespace);
        }
        if (tagName !== tagExp && attrExpPresent) {
          prefixedAttrs = this.buildAttributesMap(tagExp, this.matcher, tagName);
          if (prefixedAttrs) {
            rawAttrs = extractRawAttributes(prefixedAttrs, options);
          }
        }
        if (tagName !== xmlObj.tagname) {
          this.isCurrentNodeStopNode = this.isItStopNode();
        }
        const startIndex = i;
        if (this.isCurrentNodeStopNode) {
          let tagContent = "";
          if (isSelfClosing) {
            i = result.closeIndex;
          } else if (options.unpairedTagsSet.has(tagName)) {
            i = result.closeIndex;
          } else {
            const result2 = this.readStopNodeData(xmlData, rawTagName, closeIndex + 1);
            if (!result2)
              throw new Error(`Unexpected end of ${rawTagName}`);
            i = result2.i;
            tagContent = result2.tagContent;
          }
          const childNode = new XmlNode(tagName);
          if (prefixedAttrs) {
            childNode[":@"] = prefixedAttrs;
          }
          childNode.add(options.textNodeName, tagContent);
          this.matcher.pop();
          this.isCurrentNodeStopNode = false;
          this.addChild(currentNode, childNode, this.readonlyMatcher, startIndex);
        } else {
          if (isSelfClosing) {
            ({ tagName, tagExp } = transformTagName(options.transformTagName, tagName, tagExp, options));
            const childNode = new XmlNode(tagName);
            if (prefixedAttrs) {
              childNode[":@"] = prefixedAttrs;
            }
            this.addChild(currentNode, childNode, this.readonlyMatcher, startIndex);
            this.matcher.pop();
            this.isCurrentNodeStopNode = false;
          } else if (options.unpairedTagsSet.has(tagName)) {
            const childNode = new XmlNode(tagName);
            if (prefixedAttrs) {
              childNode[":@"] = prefixedAttrs;
            }
            this.addChild(currentNode, childNode, this.readonlyMatcher, startIndex);
            this.matcher.pop();
            this.isCurrentNodeStopNode = false;
            i = result.closeIndex;
            continue;
          } else {
            const childNode = new XmlNode(tagName);
            if (this.tagsNodeStack.length > options.maxNestedTags) {
              throw new Error("Maximum nested tags exceeded");
            }
            this.tagsNodeStack.push(currentNode);
            if (prefixedAttrs) {
              childNode[":@"] = prefixedAttrs;
            }
            this.addChild(currentNode, childNode, this.readonlyMatcher, startIndex);
            currentNode = childNode;
          }
          textData = "";
          i = closeIndex;
        }
      }
    } else {
      textData += xmlData[i];
    }
  }
  return xmlObj.child;
};
function addChild(currentNode, childNode, matcher, startIndex) {
  if (!this.options.captureMetaData)
    startIndex = undefined;
  const jPathOrMatcher = this.options.jPath ? matcher.toString() : matcher;
  const result = this.options.updateTag(childNode.tagname, jPathOrMatcher, childNode[":@"]);
  if (result === false) {} else if (typeof result === "string") {
    childNode.tagname = result;
    currentNode.addChild(childNode, startIndex);
  } else {
    currentNode.addChild(childNode, startIndex);
  }
}
function replaceEntitiesValue(val, tagName, jPath) {
  const entityConfig = this.options.processEntities;
  if (!entityConfig || !entityConfig.enabled) {
    return val;
  }
  if (entityConfig.allowedTags) {
    const jPathOrMatcher = this.options.jPath ? jPath.toString() : jPath;
    const allowed = Array.isArray(entityConfig.allowedTags) ? entityConfig.allowedTags.includes(tagName) : entityConfig.allowedTags(tagName, jPathOrMatcher);
    if (!allowed) {
      return val;
    }
  }
  if (entityConfig.tagFilter) {
    const jPathOrMatcher = this.options.jPath ? jPath.toString() : jPath;
    if (!entityConfig.tagFilter(tagName, jPathOrMatcher)) {
      return val;
    }
  }
  return this.entityDecoder.decode(val);
}
function saveTextToParentTag(textData, parentNode, matcher, isLeafNode) {
  if (textData) {
    if (isLeafNode === undefined)
      isLeafNode = parentNode.child.length === 0;
    textData = this.parseTextData(textData, parentNode.tagname, matcher, false, parentNode[":@"] ? Object.keys(parentNode[":@"]).length !== 0 : false, isLeafNode);
    if (textData !== undefined && textData !== "")
      parentNode.add(this.options.textNodeName, textData);
    textData = "";
  }
  return textData;
}
function isItStopNode() {
  if (this.stopNodeExpressionsSet.size === 0)
    return false;
  return this.matcher.matchesAny(this.stopNodeExpressionsSet);
}
function tagExpWithClosingIndex(xmlData, i, closingChar = ">") {
  let attrBoundary = 0;
  const len = xmlData.length;
  const closeCode0 = closingChar.charCodeAt(0);
  const closeCode1 = closingChar.length > 1 ? closingChar.charCodeAt(1) : -1;
  let result = "";
  let segmentStart = i;
  for (let index = i;index < len; index++) {
    const code = xmlData.charCodeAt(index);
    if (attrBoundary) {
      if (code === attrBoundary)
        attrBoundary = 0;
    } else if (code === 34 || code === 39) {
      attrBoundary = code;
    } else if (code === closeCode0) {
      if (closeCode1 !== -1) {
        if (xmlData.charCodeAt(index + 1) === closeCode1) {
          result += xmlData.substring(segmentStart, index);
          return { data: result, index };
        }
      } else {
        result += xmlData.substring(segmentStart, index);
        return { data: result, index };
      }
    } else if (code === 9 && !attrBoundary) {
      result += xmlData.substring(segmentStart, index) + " ";
      segmentStart = index + 1;
    }
  }
}
function findClosingIndex(xmlData, str, i, errMsg) {
  const closingIndex = xmlData.indexOf(str, i);
  if (closingIndex === -1) {
    throw new Error(errMsg);
  } else {
    return closingIndex + str.length - 1;
  }
}
function findClosingChar(xmlData, char, i, errMsg) {
  const closingIndex = xmlData.indexOf(char, i);
  if (closingIndex === -1)
    throw new Error(errMsg);
  return closingIndex;
}
function readTagExp(xmlData, i, removeNSPrefix, closingChar = ">") {
  const result = tagExpWithClosingIndex(xmlData, i + 1, closingChar);
  if (!result)
    return;
  let tagExp = result.data;
  const closeIndex = result.index;
  const separatorIndex = tagExp.search(/\s/);
  let tagName = tagExp;
  let attrExpPresent = true;
  if (separatorIndex !== -1) {
    tagName = tagExp.substring(0, separatorIndex);
    tagExp = tagExp.substring(separatorIndex + 1).trimStart();
  }
  const rawTagName = tagName;
  if (removeNSPrefix) {
    const colonIndex = tagName.indexOf(":");
    if (colonIndex !== -1) {
      tagName = tagName.substr(colonIndex + 1);
      attrExpPresent = tagName !== result.data.substr(colonIndex + 1);
    }
  }
  return {
    tagName,
    tagExp,
    closeIndex,
    attrExpPresent,
    rawTagName
  };
}
function readStopNodeData(xmlData, tagName, i) {
  const startIndex = i;
  let openTagCount = 1;
  const xmllen = xmlData.length;
  for (;i < xmllen; i++) {
    if (xmlData[i] === "<") {
      const c1 = xmlData.charCodeAt(i + 1);
      if (c1 === 47) {
        const closeIndex = findClosingChar(xmlData, ">", i, `${tagName} is not closed`);
        let closeTagName = xmlData.substring(i + 2, closeIndex).trim();
        if (closeTagName === tagName) {
          openTagCount--;
          if (openTagCount === 0) {
            return {
              tagContent: xmlData.substring(startIndex, i),
              i: closeIndex
            };
          }
        }
        i = closeIndex;
      } else if (c1 === 63) {
        const closeIndex = findClosingIndex(xmlData, "?>", i + 1, "StopNode is not closed.");
        i = closeIndex;
      } else if (c1 === 33 && xmlData.charCodeAt(i + 2) === 45 && xmlData.charCodeAt(i + 3) === 45) {
        const closeIndex = findClosingIndex(xmlData, "-->", i + 3, "StopNode is not closed.");
        i = closeIndex;
      } else if (c1 === 33 && xmlData.charCodeAt(i + 2) === 91) {
        const closeIndex = findClosingIndex(xmlData, "]]>", i, "StopNode is not closed.") - 2;
        i = closeIndex;
      } else {
        const tagData = readTagExp(xmlData, i, false);
        if (tagData) {
          const openTagName = tagData && tagData.tagName;
          if (openTagName === tagName && tagData.tagExp[tagData.tagExp.length - 1] !== "/") {
            openTagCount++;
          }
          i = tagData.closeIndex;
        }
      }
    }
  }
}
function parseValue(val, shouldParse, options) {
  if (shouldParse && typeof val === "string") {
    const newval = val.trim();
    if (newval === "true")
      return true;
    else if (newval === "false")
      return false;
    else
      return toNumber(val, options);
  } else {
    if (isExist(val)) {
      return val;
    } else {
      return "";
    }
  }
}
function transformTagName(fn, tagName, tagExp, options) {
  if (fn) {
    const newTagName = fn(tagName);
    if (tagExp === tagName) {
      tagExp = newTagName;
    }
    tagName = newTagName;
  }
  tagName = sanitizeName(tagName, options);
  return { tagName, tagExp };
}
function sanitizeName(name, options) {
  if (criticalProperties.includes(name)) {
    throw new Error(`[SECURITY] Invalid name: "${name}" is a reserved JavaScript keyword that could cause prototype pollution`);
  } else if (DANGEROUS_PROPERTY_NAMES.includes(name)) {
    return options.onDangerousProperty(name);
  }
  return name;
}

// ../../node_modules/.bun/fast-xml-parser@5.10.1/node_modules/fast-xml-parser/src/xmlparser/node2json.js
var METADATA_SYMBOL2 = XmlNode.getMetaDataSymbol();
function stripAttributePrefix(attrs, prefix) {
  if (!attrs || typeof attrs !== "object")
    return {};
  if (!prefix)
    return attrs;
  const rawAttrs = {};
  for (const key in attrs) {
    if (key.startsWith(prefix)) {
      const rawName = key.substring(prefix.length);
      rawAttrs[rawName] = attrs[key];
    } else {
      rawAttrs[key] = attrs[key];
    }
  }
  return rawAttrs;
}
function prettify(node, options, matcher, readonlyMatcher) {
  return compress(node, options, matcher, readonlyMatcher);
}
function compress(arr, options, matcher, readonlyMatcher) {
  let text;
  const compressedObj = {};
  for (let i = 0;i < arr.length; i++) {
    const tagObj = arr[i];
    const property = propName(tagObj);
    if (property !== undefined && property !== options.textNodeName) {
      const rawAttrs = stripAttributePrefix(tagObj[":@"] || {}, options.attributeNamePrefix);
      matcher.push(property, rawAttrs);
    }
    if (property === options.textNodeName) {
      if (text === undefined)
        text = tagObj[property];
      else
        text += "" + tagObj[property];
    } else if (property === undefined) {
      continue;
    } else if (tagObj[property]) {
      let val = compress(tagObj[property], options, matcher, readonlyMatcher);
      const isLeaf = isLeafTag(val, options);
      if (Object.keys(val).length === 0 && options.alwaysCreateTextNode) {
        val[options.textNodeName] = "";
      }
      if (tagObj[":@"]) {
        assignAttributes(val, tagObj[":@"], readonlyMatcher, options);
      } else if (Object.keys(val).length === 1 && val[options.textNodeName] !== undefined && !options.alwaysCreateTextNode) {
        val = val[options.textNodeName];
      } else if (Object.keys(val).length === 0) {
        if (options.alwaysCreateTextNode)
          val[options.textNodeName] = "";
        else
          val = "";
      }
      if (tagObj[METADATA_SYMBOL2] !== undefined && typeof val === "object" && val !== null) {
        val[METADATA_SYMBOL2] = tagObj[METADATA_SYMBOL2];
      }
      if (compressedObj[property] !== undefined && Object.prototype.hasOwnProperty.call(compressedObj, property)) {
        if (!Array.isArray(compressedObj[property])) {
          compressedObj[property] = [compressedObj[property]];
        }
        compressedObj[property].push(val);
      } else {
        const jPathOrMatcher = options.jPath ? readonlyMatcher.toString() : readonlyMatcher;
        if (options.isArray(property, jPathOrMatcher, isLeaf)) {
          compressedObj[property] = [val];
        } else {
          compressedObj[property] = val;
        }
      }
      if (property !== undefined && property !== options.textNodeName) {
        matcher.pop();
      }
    }
  }
  if (typeof text === "string") {
    if (text.length > 0)
      compressedObj[options.textNodeName] = text;
  } else if (text !== undefined)
    compressedObj[options.textNodeName] = text;
  return compressedObj;
}
function propName(obj) {
  const keys = Object.keys(obj);
  for (let i = 0;i < keys.length; i++) {
    const key = keys[i];
    if (key !== ":@")
      return key;
  }
}
function assignAttributes(obj, attrMap, readonlyMatcher, options) {
  if (attrMap) {
    const keys = Object.keys(attrMap);
    const len = keys.length;
    for (let i = 0;i < len; i++) {
      const atrrName = keys[i];
      const rawAttrName = atrrName.startsWith(options.attributeNamePrefix) ? atrrName.substring(options.attributeNamePrefix.length) : atrrName;
      const jPathOrMatcher = options.jPath ? readonlyMatcher.toString() + "." + rawAttrName : readonlyMatcher;
      if (options.isArray(atrrName, jPathOrMatcher, true, true)) {
        obj[atrrName] = [attrMap[atrrName]];
      } else {
        obj[atrrName] = attrMap[atrrName];
      }
    }
  }
}
function isLeafTag(obj, options) {
  const { textNodeName } = options;
  const propCount = Object.keys(obj).length;
  if (propCount === 0) {
    return true;
  }
  if (propCount === 1 && (obj[textNodeName] || typeof obj[textNodeName] === "boolean" || obj[textNodeName] === 0)) {
    return true;
  }
  return false;
}

// ../../node_modules/.bun/fast-xml-parser@5.10.1/node_modules/fast-xml-parser/src/xmlparser/XMLParser.js
class XMLParser {
  constructor(options) {
    this.externalEntities = {};
    this.options = buildOptions(options);
  }
  parse(xmlData, validationOption) {
    if (typeof xmlData !== "string" && xmlData.toString) {
      xmlData = xmlData.toString();
    } else if (typeof xmlData !== "string") {
      throw new Error("XML data is accepted in String or Bytes[] form.");
    }
    if (validationOption) {
      if (validationOption === true)
        validationOption = {};
      const result = validate(xmlData, validationOption);
      if (result !== true) {
        throw Error(`${result.err.msg}:${result.err.line}:${result.err.col}`);
      }
    }
    const orderedObjParser = new OrderedObjParser(this.options, this.externalEntities);
    const orderedResult = orderedObjParser.parseXml(xmlData);
    if (this.options.preserveOrder || orderedResult === undefined)
      return orderedResult;
    else
      return prettify(orderedResult, this.options, orderedObjParser.matcher, orderedObjParser.readonlyMatcher);
  }
  addEntity(key, value) {
    if (value.indexOf("&") !== -1) {
      throw new Error("Entity value can't have '&'");
    } else if (key.indexOf("&") !== -1 || key.indexOf(";") !== -1) {
      throw new Error("An entity must be set without '&' and ';'. Eg. use '#xD' for '&#xD;'");
    } else if (value === "&") {
      throw new Error("An entity with value '&' is not permitted");
    } else {
      this.externalEntities[key] = value;
    }
  }
  static getMetaDataSymbol() {
    return XmlNode.getMetaDataSymbol();
  }
}

// src/client.ts
var DEFAULT_TIMEOUT_MS = 30000;
var DEFAULT_DATA_TIMEOUT_MS = 300000;
function codeForStatus(status) {
  if (status === 401 || status === 403)
    return "sync/unauthorized";
  if (status === 507)
    return "sync/quota";
  if (status === 413)
    return "sync/file-too-large";
  if (status === 429)
    return "sync/rate-limited";
  if (status >= 500)
    return "sync/server";
  return null;
}
function webdavError(status, method, url) {
  const error = new Error(`webdav: ${method} ${url} answered ${status}`);
  const code = codeForStatus(status);
  return code ? Object.assign(error, { code }) : error;
}
var networkError = (method, url, cause) => Object.assign(new Error(`webdav: ${method} ${url} failed: ${cause instanceof Error ? cause.message : String(cause)}`), { code: "sync/network" });
function basicAuth(username, password) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (const byte of bytes)
    binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}
var PROPFIND_BODY = '<?xml version="1.0" encoding="utf-8"?>' + '<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>';
var parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: true,
  isArray: (tagName) => tagName === "response" || tagName === "propstat"
});
function normalizePath(pathname) {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {}
  return decoded.replace(/\/+$/, "");
}
function createWebdavClient(options) {
  const base = options.baseUrl.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const dataTimeoutMs = options.dataTimeoutMs ?? options.timeoutMs ?? DEFAULT_DATA_TIMEOUT_MS;
  const auth = basicAuth(options.username, options.password);
  const ensured = new Set;
  const urlFor = (segments, directory = false) => {
    const path = segments.map((segment) => encodeURIComponent(segment)).join("/");
    return `${base}${path ? `/${path}` : ""}${directory ? "/" : ""}`;
  };
  async function request(method, url, init = {}) {
    try {
      return await options.fetchFn(url, {
        method,
        headers: { authorization: auth, ...init.headers },
        body: init.body,
        redirect: "follow",
        signal: AbortSignal.timeout(init.timeoutMs ?? timeoutMs)
      });
    } catch (cause) {
      throw networkError(method, url, cause);
    }
  }
  async function get(segments) {
    const url = urlFor(segments);
    const res = await request("GET", url, { timeoutMs: dataTimeoutMs });
    if (res.status === 404)
      return null;
    if (!res.ok)
      throw webdavError(res.status, "GET", url);
    return new Uint8Array(await res.arrayBuffer());
  }
  async function put(segments, bytes, opts = {}) {
    const url = urlFor(segments);
    const headers = { "content-type": "application/octet-stream" };
    if (opts.ifNoneMatch)
      headers["if-none-match"] = "*";
    const res = await request("PUT", url, {
      headers,
      body: bytes,
      timeoutMs: dataTimeoutMs
    });
    if (opts.ifNoneMatch && res.status === 412)
      return "exists";
    if (!res.ok)
      throw webdavError(res.status, "PUT", url);
    return "stored";
  }
  async function remove(segments) {
    const url = urlFor(segments);
    const res = await request("DELETE", url);
    if (!res.ok && res.status !== 404)
      throw webdavError(res.status, "DELETE", url);
  }
  async function ensureCollections(segments) {
    for (let depth = 0;depth <= segments.length; depth += 1) {
      const prefix = segments.slice(0, depth);
      const key = prefix.join("/");
      if (ensured.has(key))
        continue;
      const url = urlFor(prefix, true);
      const res = await request("MKCOL", url);
      if (!res.ok && res.status !== 405)
        throw webdavError(res.status, "MKCOL", url);
      ensured.add(key);
    }
  }
  async function listChildren(segments) {
    const url = urlFor(segments, true);
    const res = await request("PROPFIND", url, {
      headers: { depth: "1", "content-type": "application/xml; charset=utf-8" },
      body: PROPFIND_BODY
    });
    if (res.status === 404)
      return null;
    if (res.status !== 207 && !res.ok)
      throw webdavError(res.status, "PROPFIND", url);
    const text = await res.text();
    let doc;
    try {
      doc = parser.parse(text);
    } catch {
      throw new Error(`webdav: PROPFIND ${url} answered unparseable XML`);
    }
    const multistatus = doc.multistatus;
    const responses = Array.isArray(multistatus?.response) ? multistatus.response : [];
    const selfPath = normalizePath(new URL(url).pathname);
    const children = [];
    for (const entry of responses) {
      const record = entry;
      if (typeof record.href !== "string")
        continue;
      let pathname;
      try {
        pathname = new URL(record.href, url).pathname;
      } catch {
        continue;
      }
      const normalized = normalizePath(pathname);
      if (normalized === selfPath)
        continue;
      const name = normalized.slice(normalized.lastIndexOf("/") + 1);
      if (!name)
        continue;
      const propstats = Array.isArray(record.propstat) ? record.propstat : [];
      const collection = propstats.some((propstat) => {
        const prop = propstat.prop;
        const resourcetype = prop?.resourcetype;
        return resourcetype !== null && typeof resourcetype === "object" && "collection" in resourcetype;
      });
      children.push({ name, collection });
    }
    return children;
  }
  async function probe() {
    await ensureCollections([]);
    const url = urlFor([], true);
    const res = await request("PROPFIND", url, {
      headers: { depth: "0", "content-type": "application/xml; charset=utf-8" },
      body: PROPFIND_BODY
    });
    if (res.status !== 207 && !res.ok)
      throw webdavError(res.status, "PROPFIND", url);
  }
  return { get, put, remove, ensureCollections, listChildren, probe };
}

// src/settings.ts
var DEFAULT_BASE_PATH = "ReadAware";

class WebdavNotConfiguredError extends Error {
  constructor(what) {
    super(`WebDAV sync is not configured: ${what}`);
    this.name = "WebdavNotConfiguredError";
  }
}
var str = (value) => typeof value === "string" ? value.trim() : "";
function pathSegments(path) {
  return path.split("/").filter((segment) => segment.length > 0);
}
function readWebdavSettings(stored) {
  const serverUrl = str(stored?.serverUrl);
  if (!serverUrl)
    throw new WebdavNotConfiguredError("server URL is empty");
  let parsed;
  try {
    parsed = new URL(serverUrl);
  } catch {
    throw new WebdavNotConfiguredError(`"${serverUrl}" is not a valid URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new WebdavNotConfiguredError(`unsupported protocol "${parsed.protocol}"`);
  }
  return {
    serverUrl,
    username: str(stored?.username),
    basePath: str(stored?.basePath) || DEFAULT_BASE_PATH
  };
}
function webdavRootUrl(settings) {
  const url = new URL(settings.serverUrl);
  const segments = [...pathSegments(url.pathname), ...pathSegments(settings.basePath)];
  url.pathname = `/${segments.join("/")}`;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}
function webdavEndpointId(settings) {
  const url = new URL(webdavRootUrl(settings));
  const host = url.port ? `${url.hostname.toLowerCase()}:${url.port}` : url.hostname.toLowerCase();
  return `${settings.username}@${host}${url.pathname}`;
}

// src/layout.ts
function encodeKeySegment(key) {
  return encodeURIComponent(key);
}
var META_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
function metaPath(name) {
  if (!META_NAME.test(name))
    throw new Error(`invalid meta object name: ${name}`);
  return ["meta", name];
}
var EVENTS_DIR = "events";
var BLOBS_DIR = "blobs";
function deviceDir(deviceId) {
  return [EVENTS_DIR, deviceId];
}
function batchFile(deviceId, index) {
  return [EVENTS_DIR, deviceId, `${index}.json`];
}
function parseBatchName(name) {
  const match = /^(0|[1-9]\d*)\.json$/.exec(name);
  return match ? Number(match[1]) : null;
}
function blobMainPath(key) {
  return [BLOBS_DIR, encodeKeySegment(key)];
}
function blobPartsDir(key) {
  return [BLOBS_DIR, `${encodeKeySegment(key)}.parts`];
}
function blobPartPath(key, index) {
  return [...blobPartsDir(key), String(index)];
}
function parsePartName(name) {
  const match = /^(0|[1-9]\d*)$/.exec(name);
  return match ? Number(match[1]) : null;
}

// src/transport.ts
function isSealedEvent(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const event = value;
  const hlc = event.hlc;
  return typeof event.id === "string" && typeof event.nonce === "string" && typeof event.ciphertext === "string" && typeof hlc === "object" && hlc !== null && typeof hlc.wallMs === "number" && typeof hlc.counter === "number" && typeof hlc.deviceId === "string";
}
var bytesEqual = (a, b) => a.length === b.length && a.every((byte, index) => byte === b[index]);
function createWebdavTransportSession(options) {
  const { client, endpointId } = options;
  return {
    endpointId,
    probe: () => client.probe(),
    getMeta: (name) => client.get(metaPath(name)),
    async putMetaIfAbsent(name, bytes) {
      const path = metaPath(name);
      await client.ensureCollections(path.slice(0, -1));
      const outcome = await client.put(path, bytes, { ifNoneMatch: true });
      if (outcome === "exists")
        return "exists";
      const stored = await client.get(path);
      return stored && bytesEqual(stored, bytes) ? "stored" : "exists";
    },
    async listEventBatches() {
      const devices = await client.listChildren([EVENTS_DIR]);
      if (!devices)
        return [];
      const listing = [];
      for (const device of devices) {
        if (!device.collection)
          continue;
        const files = await client.listChildren(deviceDir(device.name)) ?? [];
        let count = 0;
        for (const file of files) {
          const index = parseBatchName(file.name);
          if (index !== null && index + 1 > count)
            count = index + 1;
        }
        if (count > 0)
          listing.push({ deviceId: device.name, count });
      }
      return listing;
    },
    async getEventBatch(deviceId, index) {
      const bytes = await client.get(batchFile(deviceId, index));
      if (!bytes)
        return [];
      let parsed;
      try {
        parsed = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return [];
      }
      return Array.isArray(parsed) ? parsed.filter(isSealedEvent) : [];
    },
    async putEventBatch(deviceId, index, events) {
      await client.ensureCollections(deviceDir(deviceId));
      const body = new TextEncoder().encode(JSON.stringify(events));
      const outcome = await client.put(batchFile(deviceId, index), body, {
        ifNoneMatch: true
      });
      if (outcome === "exists") {
        throw new Error(`webdav: batch ${index} already exists for device ${deviceId} — stale push index`);
      }
    },
    async putBlob(key, bytes) {
      await client.ensureCollections([BLOBS_DIR]);
      await client.put(blobMainPath(key), bytes);
    },
    getBlob: (key) => client.get(blobMainPath(key)),
    async putBlobPart(key, index, _parts, bytes) {
      await client.ensureCollections(blobPartsDir(key));
      await client.put(blobPartPath(key, index), bytes);
    },
    async commitBlob(key, parts) {
      const files = await client.listChildren(blobPartsDir(key)) ?? [];
      const present = new Set;
      for (const file of files) {
        const index = parsePartName(file.name);
        if (index !== null)
          present.add(index);
      }
      for (let index = 0;index < parts; index += 1) {
        if (!present.has(index)) {
          throw new Error(`webdav: blob "${key}" is missing part ${index} of ${parts}`);
        }
      }
      for (const index of present) {
        if (index >= parts)
          await client.remove(blobPartPath(key, index));
      }
      const descriptor = new Uint8Array(5);
      descriptor[0] = 2;
      new DataView(descriptor.buffer).setUint32(1, parts, false);
      await client.ensureCollections([BLOBS_DIR]);
      await client.put(blobMainPath(key), descriptor);
    },
    async getBlobPart(key, index) {
      const bytes = await client.get(blobPartPath(key, index));
      if (!bytes) {
        throw new Error(`webdav: blob "${key}" has no part ${index} on the server`);
      }
      return bytes;
    }
  };
}

// src/index.ts
var plugin = {
  activate(ctx) {
    const { syncTransports } = ctx.contributions;
    const network = ctx.services.network;
    if (!syncTransports || !network) {
      throw new Error("webdav-sync requires the syncTransports contribution and network service");
    }
    syncTransports.register({
      id: "webdav",
      label: "WebDAV",
      async open() {
        const settings = readWebdavSettings(ctx.services.storage.get("settings"));
        const password = await ctx.services.secrets.get("password") ?? "";
        const client = createWebdavClient({
          baseUrl: webdavRootUrl(settings),
          username: settings.username,
          password,
          fetchFn: (url, init) => network.fetch(url, init)
        });
        return createWebdavTransportSession({
          client,
          endpointId: webdavEndpointId(settings)
        });
      }
    });
  }
};
var src_default = plugin;
export {
  src_default as default
};
