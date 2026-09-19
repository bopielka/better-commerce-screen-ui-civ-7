var PlotCoord;
((PlotCoord2) => {
  let Range;
  ((Range2) => {
    Range2[Range2["INVALID_X"] = -9999] = "INVALID_X";
    Range2[Range2["INVALID_Y"] = -9999] = "INVALID_Y";
  })(Range || (Range = {}));
  function toString(loc) {
    if (loc) {
      const str = loc.x + ";" + loc.y;
      return str;
    } else {
      return "";
    }
  }
  PlotCoord2.toString = toString;
  function fromString(str) {
    let retVal = null;
    if (str) {
      const strs = str.split(";");
      if (strs.length >= 2) {
        retVal = { x: -9999 /* INVALID_X */, y: -9999 /* INVALID_Y */ };
        retVal.x = parseInt(strs[0]);
        retVal.y = parseInt(strs[1]);
      }
    }
    return retVal;
  }
  PlotCoord2.fromString = fromString;
  function isInvalid(loc) {
    if (loc) {
      if (loc.x <= -9999 /* INVALID_X */ && loc.y <= -9999 /* INVALID_Y */) {
        return true;
      }
    }
    return false;
  }
  PlotCoord2.isInvalid = isInvalid;
  function isValid(loc) {
    if (loc) {
      if (loc.x > -9999 /* INVALID_X */ && loc.y > -9999 /* INVALID_Y */) {
        return true;
      }
    }
    return false;
  }
  PlotCoord2.isValid = isValid;
})(PlotCoord || (PlotCoord = {}));

export { PlotCoord };
//# sourceMappingURL=utilities-plotcoord.js.map
