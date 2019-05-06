function getPosition(string, subString, index) {
    return string.split(subString, index).join(subString).length;
}

function resizeDisUrl(imgUrl, maxImgSize) {
    console.log("IMG URL: ", imgUrl, " MAX IMG SIZE: ", maxImgSize);
    var resizeIdx = imgUrl.indexOf('resize');
    if (resizeIdx >= 0) {
        var resizeStr = imgUrl.substring(resizeIdx);
        var widthStartIdx = getPosition(resizeStr, '/', 3) + resizeIdx;
        var widthEndIdx = getPosition(resizeStr, '/', 4) + resizeIdx;
        if (widthStartIdx >= 0 && widthEndIdx >= 0) {
            var resizedImgUrl = imgUrl.substring(0, widthStartIdx) + '/' + maxImgSize.toString() + imgUrl.substring(widthEndIdx);
            console.log("RESIZED URL: ", resizedImgUrl);
            return resizedImgUrl;
        }
    }
    return imgUrl;
}

module.exports = {
    resizeDisUrl: resizeDisUrl
};