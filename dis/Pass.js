var rp = require('request-promise-native');
var moment = require('moment-timezone');
var commons = require("../core/Commons");

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
                            elm.startDateTime = moment(elm.startDateTime).tz(tz);
                        }
                        if (elm.endDateTime != null) {
                            elm.endDateTime = moment(elm.endDateTime).tz(tz);
                        }
                        matchingElms.push(elm);
                        break;
                    }
                }
            }
        }
    }
    var nonStandards = fpResponse.nonStandards;
    if (nonStandards != null) {
        for (var elm of nonStandards) {
            if (elm.entitlementType == "NON") {
                for (var guest of elm.partyGuests) {
                    if (guest.guestId == passID) {
                        elm.partyGuest = guest;
                        if (elm.startDateTime != null) {
                            elm.startDateTime = moment(elm.startDateTime).tz(tz);
                        }
                        if (elm.endDateTime != null) {
                            elm.endDateTime = moment(elm.endDateTime).tz(tz);
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
        },
        json: true
    };
    var respData = await rp(options);
    return respData;
    /*
    return {
        "partyMembers": [
            {
                "name": "ALEX CRAIG",
                "nextSelectionTime": "2019-02-01T19:35:10-08:00",
                "managed": true,
                "annualPass": true,
                "id": "***REMOVED***",
                "ticketType": "PASS"
            },
            {
                "name": "***REMOVED*** CRAIG",
                "nextSelectionTime": "2019-02-01T19:35:10-08:00",
                "managed": false,
                "annualPass": true,
                "id": "***REMOVED***",
                "ticketType": "PASS"
            },
            {
                "name": "***REMOVED*** SMITH",
                "managed": false,
                "annualPass": true,
                "id": "801150013402914489",
                "ticketType": "PASS"
            },
            {
                "name": "***REMOVED*** ***REMOVED***",
                "managed": false,
                "annualPass": true,
                "id": "***REMOVED***",
                "ticketType": "PASS"
            }
        ],
        "entitlements": [
            {
                "startDateTime": "2019-02-02T03:35:00Z",
                "endDateTime": "2019-02-02T04:35:00Z",
                "operationalDate": "2019-02-01",
                "facilityType": "Attraction",
                "locationId": "16514416",
                "locationType": "Attraction",
                "parkId": "336894",
                "partyGuests": [
                    {
                        "guestId": "***REMOVED***",
                        "entitlementId": "97833072",
                        "status": "Booked",
                        "canModify": true,
                        "canCancel": true,
                        "canRedeem": false
                    },
                    {
                        "guestId": "***REMOVED***",
                        "entitlementId": "97833071",
                        "status": "Booked",
                        "canModify": true,
                        "canCancel": true,
                        "canRedeem": false
                    }
                ],
                "facility": "16514416",
                "isBonus": false
            },
            {
                "startDateTime": "2019-02-02T03:45:00Z",
                "endDateTime": "2019-02-02T04:45:00Z",
                "operationalDate": "2019-02-01",
                "facilityType": "Attraction",
                "locationId": "15822029",
                "locationType": "Attraction",
                "parkId": "336894",
                "partyGuests": [
                    {
                        "guestId": "***REMOVED***",
                        "entitlementId": "97937156",
                        "status": "Booked",
                        "canModify": true,
                        "canCancel": true,
                        "canRedeem": false
                    },
                    {
                        "guestId": "***REMOVED***",
                        "entitlementId": "97937157",
                        "status": "Booked",
                        "canModify": true,
                        "canCancel": true,
                        "canRedeem": false
                    }
                ],
                "facility": "15822029",
                "isBonus": false
            },
            {
                "startDateTime": "2019-02-02T03:20:00Z",
                "endDateTime": "2019-02-02T04:20:00Z",
                "operationalDate": "2019-02-01",
                "facilityType": "Attraction",
                "locationId": "353453",
                "locationType": "Attraction",
                "parkId": "336894",
                "partyGuests": [
                    {
                        "guestId": "***REMOVED***",
                        "entitlementId": "97860567",
                        "status": "Booked",
                        "canModify": true,
                        "canCancel": true,
                        "canRedeem": false
                    },
                    {
                        "guestId": "***REMOVED***",
                        "entitlementId": "97860566",
                        "status": "Booked",
                        "canModify": true,
                        "canCancel": true,
                        "canRedeem": false
                    }
                ],
                "facility": "353453",
                "isBonus": false
            }
        ],
        "nonStandards": [
            {
                "entitlementType": "NON",
                "reason": "AGR",
                "usesAllowed": 1,
                "returnEndDate": "2019-02-01",
                "startDateTime": "2019-02-01T19:40:00-08:00",
                "partyGuests": [
                    {
                        "guestId": "***REMOVED***",
                        "entitlementId": "97947308",
                        "status": "Booked",
                        "usesRemaining": 1,
                        "canRedeem": false
                    },
                    {
                        "guestId": "***REMOVED***",
                        "entitlementId": "97947311",
                        "status": "Booked",
                        "usesRemaining": 1,
                        "canRedeem": false
                    }
                ],
                "experiences": [
                    {
                        "facility": "15822029",
                        "facilityType": "Attraction",
                        "locationId": "15822029",
                        "locationType": "Attraction",
                        "parkId": "336894"
                    },
                    {
                        "facility": "353451",
                        "facilityType": "Attraction",
                        "locationId": "353451",
                        "locationType": "Attraction",
                        "parkId": "336894"
                    },
                    {
                        "facility": "16514416",
                        "facilityType": "Attraction",
                        "locationId": "16514416",
                        "locationType": "Attraction",
                        "parkId": "336894"
                    },
                    {
                        "facility": "353453",
                        "facilityType": "Attraction",
                        "locationId": "353453",
                        "locationType": "Attraction",
                        "parkId": "336894"
                    },
                    {
                        "facility": "353431",
                        "facilityType": "Attraction",
                        "locationId": "353431",
                        "locationType": "Attraction",
                        "parkId": "336894"
                    },
                    {
                        "facility": "353303",
                        "facilityType": "Attraction",
                        "locationId": "353303",
                        "locationType": "Attraction",
                        "parkId": "336894"
                    }
                ]
            }
        ]
    };
    */
}

async function getFastPassesForPassID(passID, disID, accessToken, tz) {
    var respData = await getFastPasses(disID, accessToken);
    console.log("GET FAST PASS RESP DATA: ", JSON.stringify(respData, null, 2));
    var entitlements = getEntitlementsForPassID(passID, respData, tz);
    console.log("GET FAST PASS RESP DATA2: ", JSON.stringify(respData, null, 2));
    console.log("FP ENTITLEMENTS: ", JSON.stringify(entitlements, null, 2));
    var nextSelectionDateTime = getSelectionDateTimeForPassID(passID, respData, tz);
    console.log("NEXT SELECTION DT: ", nextSelectionDateTime, (nextSelectionDateTime != null)? nextSelectionDateTime.format("YYYY-MM-DD HH:mm:ss"): null);
    var earliestSelectionDateTime = null;
    if (nextSelectionDateTime) {
        earliestSelectionDateTime = getEarliestPossibleSelectionDateTime(nextSelectionDateTime, entitlements);
    }

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
                        if (fpTran.startDateTime != null) {
                            if (fpTran.startDateTime < entitlement.startDateTime) {
                                fpTran.startDateTime = entitlement.startDateTime;
                            } else if (fpTran.endDateTime != null && fpTran.endDateTime > entitlement.endDateTime) {
                                fpTran.endDateTime = entitlement.endDateTime;
                            }
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
                    passes: []
                };
                fastPassTransactions.push(matchingFpTran);
            }
            matchingFpTran.passes.push({ 
                id: fpResp.passID, 
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
    };
}

async function fillPartyWithPasses(passIDs, disID, accessToken) {
    var conflicts = await getPartyFastPassConflicts(disID, accessToken);
    var partyMembers = conflicts["partyMembers"];
    console.log("PARTYMEMBERS: ", JSON.stringify(partyMembers, null, 2));

    var passIDMap = {};
    var passIDsToPartyMembers = commons.indexArray({}, partyMembers, "id");
    console.log("PASSIDS TO PARTY MEMBERS: ", JSON.stringify(passIDsToPartyMembers, null, 2));
    var newPassIDs = [];
    for (var passID of passIDs) {
        if (passIDsToPartyMembers[passID] == null) {
            newPassIDs.push(passID);
        }
    }
    var addPromises = [];
    for (var passID of newPassIDs) {
        console.log("ADD PASS: ", passID);
        addPromises.push(addPartyMember(passID, disID, accessToken));
    }
    var excessPassIDs = [];
    for (var partyPassID in passIDsToPartyMembers) {
        var found = false;
        for (var passID of passIDs) {
            if (passID == partyPassID) {
                found = true;
                break;
            } 
        }
        if (!found) {
            excessPassIDs.push(passID);
        }
    }
    await Promise.all(addPromises);
    
    var result = {
        "addedPassIDs": newPassIDs,
        "excessPassIDs": excessPassIDs
    };
    console.log("RESULT: ", JSON.stringify(result, null, 2));
    return result;
}

async function removePartyMembers(passIDs, disID, accessToken) {
    var promises = [];
    for (var passID of passIDs) {
        promises.push(removePartyMember(passID, disID, accessToken));
    }
    await Promise.all(promises);
}

async function addPartyMember(passID, disID, accessToken) {
    var options = {
        method: 'POST',
        uri: `https://tms.dlr.wdpro.disney.com/ticket-management-service/v2/entitlements/${passID}/guests`,
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `BEARER ${accessToken}`,
            'Accept-Encoding': 'gzip'
        },
        body: {
            'profileId': disID,
            'guest_type': 'SHARED'
        },
        json: true,
        gzip: true
    };
    console.log("ADD: ", JSON.stringify(options));
    await rp(options);
}

async function removePartyMember(passID, disID, accessToken) {
    var options = {
        method: 'DELETE',
        uri: `https://tms.dlr.wdpro.disney.com/ticket-management-service/v2/entitlements/${passID}/guests/${disID}`,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `BEARER ${accessToken}`,
            'Accept-Encoding': 'gzip'
        }
    };
    await rp(options);
}

/*
    Not needed except in early stages
 */
async function getPartyFastPassConflicts(disID, accessToken) {
    var options = {
        method: 'GET',
        uri: 'https://selection-svcs.fastpass.disneyland.disney.go.com/gxp-services/services/orchestration/guest/' + disID + '/party',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': 'BEARER ' + accessToken,
            'Accept-Encoding': 'gzip',
            'X-Guest-ID': disID
        },
        json: true,
        gzip: true
    };
    console.log("CONFICT REQ: ", JSON.stringify(options, null, 2));
    var respData = await rp(options);
    /*
    var respData = {
        "conflicts": [
            {
                "guestXid": "801150013402914489",
                "message": "NOT_ENTERED_PARK"
            },
            {
                "guestXid": "***REMOVED***",
                "message": "NOT_ENTERED_PARK"
            }
        ],
        "partyMembers": [
            {
                "annualPass": true,
                "gxpEligible": true,
                "id": "***REMOVED***",
                "managed": false,
                "maxPass": true,
                "name": "ALEX CRAIG",
                "ticketType": "PASS",
                "nextSelectionTime": "2019-02-01T13:31:39-08:00",
            },
            {
                "annualPass": true,
                "gxpEligible": true,
                "id": "***REMOVED***",
                "lastParkEntered": "330339",
                "managed": false,
                "maxPass": true,
                "nextSelectionTime": "2019-02-01T13:31:39-08:00",
                "ticketType": "PASS"
            }
        ]
    };
    */
    console.log("CONFLICTS RESP: ", JSON.stringify(respData, null, 2));
    return respData;
}

async function getMaxPassInfo(disID, passIDs, parkID, rideID, startTime, endTime, date, accessToken, tz) {
    var dateStr = date.format("YYYY-MM-DD");

    var passIDsStr = "";
    passIDs.forEach((passID, i) => {
        if (passIDsStr.length > 0) {
            passIDsStr += ",";
        }
        passIDsStr += passID;
    });
    var startTimeStr = startTime.format("H:m:s");
    var endTimeStr = endTime.format("HH:mm:ss");
    var respData = null;
    try {
        var options = {
            method: 'POST',
            uri: `https://selection-svcs.fastpass.disneyland.disney.go.com/gxp-services/services/orchestration/park/${parkID}/${dateStr}/offers;guest-xids=${passIDsStr};start-time=${startTimeStr};end-time=${endTimeStr}?includeAssets=false`,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': 'BEARER ' + accessToken,
                'Accept-Encoding': 'gzip',
                'X-Guest-ID': disID
            },
            json: true,
            gzip: true
        };
        console.log("ENTITLEMENTS OPTIONS", JSON.stringify(options, null, 2));
        respData = await rp(options);
    } catch (e) {
        endTimeStr = endTime.format("H:m:s");
        var options = {
            method: 'POST',
            uri: `https://selection-svcs.fastpass.disneyland.disney.go.com/gxp-services/services/orchestration/parks/${parkID}/${dateStr}/offers/guest-xids=${passIDsStr};start-time=${startTimeStr};end-time=${endTimeStr}?includeAssets=false`,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': 'BEARER ' + accessToken,
                'Accept-Encoding': 'gzip',
                'X-Guest-ID': disID
            },
            json: true,
            gzip: true
        };
        console.log("ENTITLEMENTS OPTIONS2", JSON.stringify(options, null, 2));
        respData = await rp(options);
    }
    /*
    var respData = {
        "experienceGroups": [
            {
                "experiences": [
                    {
                        "id": "353295",
                        "offers": [
                            {
                                "endDateTime": "2019-02-01T15:10:00.000",
                                "startDateTime": "2019-02-01T14:10:00.000",
                                "facilityId": "353451",
                                "facilityType": "Attraction",
                                "id": "281250737",
                                "locationId": "353451",
                                "locationType": "Attraction",
                            }    
                        ],
                        "status": "AVAILABLE",
                        "type": "Attraction"
                    }    
                ]
            }  
        ]
    };
    */
    console.log("ENTITELMENT RESP: ", JSON.stringify(respData, null, 2));
    if (respData["experienceGroups"] != null) {
        for (var experienceGroup of respData["experienceGroups"]) {
            if (experienceGroup["experiences"] != null) {
                for (var experience of experienceGroup["experiences"]) {
                    if (experience.id == rideID) {
                        if (experience["status"] == "AVAILABLE") {
                            var offers = experience["offers"];
                            if (offers != null && offers.length > 0) {
                                var offer = offers[0];
                                return {
                                    "id": offer["id"],
                                    "fastPassDateTime": moment(offer["startDateTime"]).tz(tz, true)
                                };
                            }
                        }
                    }
                }
            }
        }
    }
    return null;
}

async function reserveFastPass(maxPassID, excludePassIDs, disID, accessToken, tz) {
    //TODO: Determine how guestsToExclude is calculated
    {
    var options = {
        method: 'POST',
        uri: `https://selection-svcs.fastpass.disneyland.disney.go.com/gxp-services/services/orchestration/inventory/${maxPassID}`,
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': 'BEARER ' + accessToken,
            'Accept-Encoding': 'gzip',
            'X-Guest-ID': disID
        },
        json: true,
        gzip: true
    };
    console.log("RESERVE OPTIONS: ", JSON.stringify(options, null, 2));
    var resp = await rp(options);
    }
    var options = {
        method: 'POST',
        uri: `https://selection-svcs.fastpass.disneyland.disney.go.com/gxp-services/services/orchestration/offer/${maxPassID}`,
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': 'BEARER ' + accessToken,
            'Accept-Encoding': 'gzip',
            'X-Guest-ID': disID
        },
        body: {
            "guestsToExclude": []
        },
        json: true,
        gzip: true
    };
    console.log("RESERVE OPTIONS: ", JSON.stringify(options, null, 2));
    var resp = await rp(options);
    /*
    var resp = {
        "eligibleSelectionTime": {
            "individualSelectionTimeDetails": [
                {
                    "guestId": "***REMOVED***",
                    "selectionDateTime": "2019-02-01T13:31:39.216-08:00"
                }
            ]
        }
    };
    */
    console.log("RESERVE RESP: ", JSON.stringify(resp, null, 2));
    var selectionTimes = resp["eligibleSelectionTime"]["individualSelectionTimeDetails"];
    var passSelectionTimes = [];
    for (var selectionTime of selectionTimes) {
        var selectionDateTime = null;
        if (selectionTime.selectionDateTime != null) {
            selectionDateTime = moment(selectionTime.selectionDateTime).tz(tz);
        }
        passSelectionTimes.push({
            passID: selectionTime.guestId,
            selectionDateTime: selectionDateTime
        });
    }
    return passSelectionTimes;
}

async function orderPartyMaxPass(parkID, rideID, parkDate, parkCloseDateTime, passIDs, disID, accessToken, tz) {
    var startDateTime = moment().tz(tz);
    var partyPassRes = null;
    partyPassRes = await fillPartyWithPasses(passIDs, disID, accessToken);
    var endDateTime = startDateTime.clone().add(1, 'hour');
    var conflictResp = await getPartyFastPassConflicts(disID, accessToken);
    var conflicts = conflictResp["conflicts"];
    var conflictFound = false;
    if (conflicts != null) {
        for (var conflict of conflicts) {
            for (var passID of passIDs) {
                if (conflict["guestXid"] == passID) {
                    conflictFound = true;
                }
            }
        }
    }
    if (conflictFound) {
        await removePartyMembers(partyPassRes.addedPassIDs, disID, accessToken);
        throw "Conflict";
    }
    var maxPassInfo = await getMaxPassInfo(disID, passIDs, parkID, rideID, startDateTime, endDateTime, parkDate, accessToken, tz);
    //The FastPass is no longer available
    if (maxPassInfo == null) {
        console.log("NULL MAX PASS INFO");
        await removePartyMembers(partyPassRes.addedPassIDs, disID, accessToken);
        return null;
    }
    
    console.log("RESERVING");
    var selectionTimes = await reserveFastPass(maxPassInfo.id, partyPassRes.excessPassIDs, disID, accessToken);
    console.log("RESERVE DONE");
    await removePartyMembers(partyPassRes.addedPassIDs, disID, accessToken);

    return {
        fastPassDateTime: maxPassInfo.fastPassDateTime,
        passes: selectionTimes
    };
}

module.exports = {
    getBlockLevel: getBlockLevel,
    getEarliestPossibleSelectionDateTime: getEarliestPossibleSelectionDateTime,
    getPass: getPass,
    getParsedPass: getParsedPass,
    getFastPasses: getFastPasses,
    getFastPassesForPassID: getFastPassesForPassID,
    aggregateFastPassesForPassIDs: aggregateFastPassesForPassIDs,
    orderPartyMaxPass: orderPartyMaxPass,
    fillPartyWithPasses: fillPartyWithPasses
};