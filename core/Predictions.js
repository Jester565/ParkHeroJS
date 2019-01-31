//TODO: May have to handle unpredictable fpt values after fast passes expire
async function getFastPassPrediction(rideID, dateTime, query) {
    var firstDT = dateTime.clone().set({minute: 0, second: 0, millisecond: 0});
    var lastDT = dateTime.clone().set({hour: dateTime.hours() + 1, minute: 0, second: 0, millisecond: 0});
    var dtDiff = lastDT.getTime() - firstDT.getTime();
    var fpTimes = await query(`SELECT fastpassTime AS fpt, openHour AS openHour, hoursOpen AS hoursOpen
        FROM BatchResults 
        WHERE rideID=? AND (dateTime=? OR dateTime=?) ORDER BY dateTime`, 
        [rideID, firstDT.format("YYYY-MM-DD HH:mm:ss"), lastDT.format("YYYY-MM-DD HH:mm:ss")]);
    var predTime = null;
    if (fpTimes.length == 2) {
        var fpDiff = fpTimes[0].fpt.getTime() - fpTimes[1].fpt.getTime();
        predTime = moment(fpTimes[0].fpt.getTime() + fpDiff * (dtDiff / (60 * 60 * 1000)));
        var predHours = predTime.hours();
        if (predHours < 4) {
            predHours += 24;
        }
        if (predHours >= fpTimes[0].openHour + fpTimes[0].hoursOpen - 1) {
            if (predTime.minutes() >= 30) {
                predTime = null;
            }
        }
    } else {
        predTime = null;
    }
    //Round down to nearest 5 minutes
    if (predTime != null) {
        predTime.set({minute: ((int)(predTime.minutes() / 5)) * 5, second: 0, millisecond: 0})
    }
    
    return predTime;
}

module.exports = {
    getFastPassPrediction: getFastPassPrediction
};