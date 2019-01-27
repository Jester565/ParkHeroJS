var rp = require('request-promise-native');
var moment = require('moment-timezone');

async function getPass(passID, accessToken) {
    var options = {
        method: 'GET',
        uri: 'https://evas.dlr.wdpro.disney.com/entitlement-view-assembly-service/entitlements/' + passID + '?fields=productINstance.names%2Centitlement',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': 'BEARER ' + accessToken
        },
        json: true
    };
    var respData = await rp(options);
    return respData['entitlement'];
}

function stripTimezone(dt) {
    return moment(moment(dt).format("YYYY-MM-DD HH:mm"), "YYYY-MM-DD HH:mm");
}

function getEntitlementsForPassID(passID, fpResponse, tz) {
    var entitlements = fpResponse.entitlements;
    var matchingElms = [];
    if (entitlements != null) {
        for (var elm of entitlements) {
            if (elm.partyGuests != null) {
                for (var guest of elm.partyGuests) {
                    if (guest.guestId == passID) {
                        elm.partyGuest = guest;
                        if (elm.startDateTime != null) {
                            elm.startDateTime = stripTimezone(elm.startDateTime);
                        }
                        if (elm.endDateTime != null) {
                            elm.endDateTime = stripTimezone(elm.endDateTime);
                        }
                        matchingElms.push(elm);
                        break;
                    }
                }
            }
        }
    }
    return matchingElms;
}

function getSelectionDateTimeForPassID(passID, fpResponse, tz) {
    for (var guest of fpResponse.partyMembers) {
        if (guest.id == passID && guest.nextSelectionTime != null) {
            return moment(guest.nextSelectionTime).tz(tz);
        }
    }
    return null;
}

//A fast pass can potentially be used 30 minutes the selection time, meaning the selectionTime is not necessarily the earliest time possible
function getEarliestPossibleSelectionDateTime(selectionDateTime, passEntitlements) {
    var earliestDateTime = selectionDateTime.clone();
    earliestDateTime.subtract(35, 'minutes');
    var earliestDtSet = false;
    for (var entitlement of passEntitlements) {
        if (entitlement.startDateTime != null) {
            //stripping away the incorrect timezone information and making it local
            var fpDT = entitlement.startDateTime;
            if (fpDT >= earliestDateTime && fpDT < selectionDateTime) {
                earliestDateTime = fpDT;
                earliestDtSet = true;
            }
        }
    }
    if (earliestDtSet) {
        return earliestDateTime;
    } else {
        return selectionDateTime.clone();
    }
}

async function getFastPasses(disID, accessToken) {
    var options = {
        method: 'GET',
        uri: `http://origin.prod.dlr-fp-selection.dlr-fastpass.us-west-2.wdpro.disney.com:8080/gxp-services/services/orchestration/guest/${disID}/selections`,
        headers: {
            'X-Guest-ID': disID,
            'Accept': 'text/plain',
            'Content-Type': 'application/json',
            'Authorization': `BEARER ${accessToken}`,
            'Accept-Language': 'en'
        }
    };
    var respData = await rp(options);
    return respData;
}

async function getFastPassesForPassID(passID, disID, accessToken, tz) {
    var respData = await getFastPasses(disID, accessToken);
    var entitlements = getEntitlementsForPassID(passID, respData);
    var nextSelectionDateTime = getSelectionDateTimeForPassID(passID, respData, tz);
    var earliestSelectionDateTime = getEarliestPossibleSelectionDateTime(nextSelectionDateTime, entitlements);

    return {
        passID: passID,
        disID: disID,
        entitlements: entitlements,
        selectionDateTime: nextSelectionDateTime,
        earliestSelectionDateTime: earliestSelectionDateTime,
        resp: respData
    };
}

function getLatestSelectionDateTime(selectionTimes) {
    var latestSelectionDateTime = null;
    for (var selectionTime of selectionTimes) {
        if (latestSelectionDateTime == null || selectionTime > latestSelectionDateTime) {
            latestSelectionDateTime = selectionTime;
        }
    }
    return latestSelectionDateTime;
}

async function aggregateFastPassesForPassIDs(passAndDisIDs, accessToken, tz) {
    var fpPromises = [];
    for (var passAndDisID of passAndDisIDs) {
        fpPromises.push(getFastPassesForPassID(passAndDisID.passID, passAndDisID.disID, accessToken, tz));
    }
    var fpPassResps = await Promise.all(fpPromises);

    var selectionTimes = [];
    var earliestSelectionTimes = [];
    for (var fpResp of fpPassResps) {
        selectionTimes.push(fpResp.selectionDateTime);
        earliestSelectionTimes.push(fpResp.earliestSelectionDateTime);
    }
    var selectionDT = getLatestSelectionDateTime(selectionTimes);
    var earlistSelectionDT = getLatestSelectionDateTime(earliestSelectionTimes);
    var fastPassTransactions = [];
    for (var fpResp of fpPassResps) {
        for (var entitlement of fpResp.entitlements) {
            var matchingFpTran = null;
            for (var fpTran of fastPassTransactions) {
                if (fpTran.rideID == entitlement.locationId) {
                    if ((fpTran.startDateTime == null && entitlement.startDateTime == null) || (
                        (fpTran.startDateTime != null && entitlement.startDateTime != null) &&
                        Math.abs(moment.duration(fpTran.startDateTime.diff(entitlement.startDateTime)).asMinutes()) <= 10)) 
                    {
                        if (fpTran.startDateTime < entitlement.startDateTime) {
                            fpTran.startDateTime = entitlement.startDateTime;
                        } else if (fpTran.endDateTime > entitlement.endDateTime) {
                            fpTran.endDateTime = entitlement.endDateTime;
                        }
                        
                        matchingFpTran = fpTran;
                        break;
                    }
                }
            }
            if (matchingFpTran == null) {
                matchingFpTran = {
                    rideID: entitlement.locationId,
                    startDateTime: entitlement.startDateTime,
                    endDateTime: entitlement.endDateTime,
                    fps: []
                };
                fastPassTransactions.push(matchingFpTran);
            }
            matchingFpTran.fps.push({ 
                passID: fpResp.passID, 
                startDateTime: entitlement.startDateTime, 
                endDateTime: entitlement.endDateTime });
        }
    }

    fastPassTransactions.sort((t1, t2) => {
        if (t1.startDateTime == null) {
            return -1;
        } else if (t2.startDateTime == null) {
            return 1;
        }
        if (t1.startDateTime < t2.startDateTime) {
            return -1;
        } else if (t1.startDateTime > t2.startDateTime) {
            return 1;
        }
        return 0;
    });

    return {
        selectionDateTime: selectionDT,
        earliestSelectionDateTime: earlistSelectionDT,
        transactions: fastPassTransactions
    }
}

module.exports = {
    getPass: getPass,
    getFastPasses: getFastPasses,
    getFastPassesForPassID: getFastPassesForPassID,
    aggregateFastPassesForPassIDs: aggregateFastPassesForPassIDs
};