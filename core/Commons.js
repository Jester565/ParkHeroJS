function indexArray(arrMap, arr, idxName, valName = null) {
    for (var result of arr) {
        var obj = arrMap[result[idxName]];
        if (obj == null) {
            arrMap[result[idxName]] = [];
            obj = arrMap[result[idxName]];
        }
        delete result[idxName];
        if (valName == null) {
            obj.push(result);
        } else {
            obj.push(result[valName]);
        }
    }
    return arrMap;
}

module.exports = {
    indexArray: indexArray
}