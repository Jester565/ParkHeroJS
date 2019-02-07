var rp = require('request-promise-native');
var moment = require('moment-timezone');

function getBlockLevel(type) {
    if (type == "socal-select-annual") {
        return 0;
    } else if (type == "socal-annual" || type == "dlrSocalAnnualPass") {
        return 1;
    } else if (type == "deluxe-annual") {
        return 2;
    } else if (type == "signature") {
        return 3;
    } else if (type == "signature-plus") {
        return 4;
    }
    return 5;  //Probably a day pass
}

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

async function getParsedPass(passID, accessToken, tz) {
    var pass = await getPass(passID, accessToken);
    var disID = pass["primaryGuest"];
    var name = null;
    if (pass["assignedGuest"] != null) {
        var nickname = pass["assignedGuest"]["nickname"];
        var firstName = pass["assignedGuest"]["firstName"];
        var lastName = pass["assignedGuest"]["lastName"];
        if (nickname != null) {
            name = nickname;
        } else if (firstName != null) {
            name = firstName;
            if (lastName != null) {
                name += " " + lastName;
            }
        }
    }
    var type = pass["productTypeId"];
    var expireDT = null;
    if (pass["endDateTime"] != null) {
        expireDT = moment(pass["endDateTime"]).tz(tz);
    }
    var hasMaxPass = false;
    if (pass["featureIds"] != null) {
        for (var feature of pass["featureIds"]) {
            if (feature == "MaxPass") {
                hasMaxPass = true;
                break;
            }
        }
    }
    if (!hasMaxPass && pass["addons"] != null) {
        for (var addon of pass["addons"]) {
            if (addon["parentVisualId"] == passID 
                && addon["productTypeId"] == 'dlr-maxpass') 
            {
                var startDateTime = moment(addon["startDateTime"]).tz(tz);
                var endDateTime = moment(addon["endDateTime"]).tz(tz);
                var now = moment().tz(tz);
                if (startDateTime <= now && now <= endDateTime) {
                    hasMaxPass = true;
                }
            }
        }
    }
    return {
        passID: passID,
        disID: disID,
        name: name,
        type: type,
        blockLevel: getBlockLevel(type),
        expireDT: expireDT,
        hasMaxPass: hasMaxPass
    };
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

function aggregateSimilarFastPasses(fpPassResps) {
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
    return fastPassTransactions;
}

function sortFastPassTransactions(fastPassTransactions) {
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
}

/*
    passAndDisIDs: [ { passID, disID } ]

    Response:
    {
        selectionDateTime,
        earliestSelectionDateTime,
        transactions: [
            {
                rideID,
                startDateTime,
                endDateTime,
                fps: [
                    { 
                        passID,
                        startDateTime,
                        endDateTime
                    }
                ]
            }
        ],
        individualReps: [
            {
                passID,
                disID,
                entitlements: [],
                selectionDateTime,
                earliestSelectionDateTime
            }
        ]
    }
*/
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
    
    //I refer to common fastPasses as transactions
    var transactions = aggregateSimilarFastPasses(fpPassResps);
    sortFastPassTransactions(transactions);
    
    return {
        selectionDateTime: selectionDT,
        earliestSelectionDateTime: earlistSelectionDT,
        transactions: transactions,
        individualResps: fpPassResps
    }
}

module.exports = {
    getBlockLevel: getBlockLevel,
    getPass: getPass,
    getParsedPass: getParsedPass,
    getFastPasses: getFastPasses,
    getFastPassesForPassID: getFastPassesForPassID,
    aggregateFastPassesForPassIDs: aggregateFastPassesForPassIDs
};