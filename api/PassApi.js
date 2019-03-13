var config = require('./config');
var userManager = require('../core/User');
var passManager = require('../core/PassManager');
var commons = require('./Commons');
var authManager = require('../core/AuthManager');

var query = commons.getDatabaseQueryMethod();

/*
    Response: [
        {
            user: {
                id,
                name,
                profilePicUrl
            },
            passes: [{
                id,
                name,
                type,
                expirationDT,
                isPrimary,
                isEnabled,
                hasMaxPass
            }]
        }
    ]
*/
async function getUserPasses(_, userID) {
    var userPasses = await passManager.getPassesForUsers([userID]);
    return userPasses;
}

/*
    Response: {
        userPasses: 
        [
            {
                user: {
                    id,
                    name,
                    profilePicUrl
                },
                passes: [{
                    id,
                    name,
                    type,
                    expirationDT,
                    isPrimary,
                    isEnabled,
                    hasMaxPass
                }]
            }
        ],
        splitters: [String]
    }
*/
async function getPartyPasses(_, userID) {
    var partyID = await userManager.getPartyID(userID, query);
    var partyMembers = await userManager.getPartyMembers(userID, query);
    var userIDs = [];
    for (var partyMember of partyMembers) {
        userIDs.push(partyMember.id);
    }
    if (userIDs.length == 0) {
        userIDs.push(userID);
    }
    var userPasses = await passManager.getPartyMembers(userID, query);
    var splitters = await passManager.getSplitters(partyID + ":" + partyID);
    return {
        userPasses: userPasses,
        splitters: splitters
    };
}

/*
    body: {
        groupID,
        action
    }
    ---
    response: [String]
*/
async function updateSplitters(body, userID) {
    var groupID = body["groupID"];
    var action = body["action"];
    var partyID = userManager.getPartyID(userID, query);
    if (partyID == null) {
        throw "User not in party";
    }
    var realGroupID = partyID + ":" + groupID;
    if (action == "split") {
        await passManager.splitPasses(realGroupID, userID);
    } else if (action == "unsplit") {
        await passManager.unsplitPasses(realGroupID, userID);
    } else if (action == "merge") {
        await passManager.mergePasses(realGroupID);
    } else {
        throw "Unknown action: " + action;
    }
    var splitters = await passManager.getSplitters(realGroupID);
    return splitters;
}

/*
    body: {
        passID,
        isPrimary,
        isEnabled
    }
*/
async function updatePass(body, userID) {
    var passID = body["passID"];
    var isPrimary = body["isPrimary"];
    var isEnabled = body["isEnabled"];
    
    var accessToken = await authManager.getAccessToken('0', config.dis.username, config.dis.password, query);
    await passManager.updatePass(userID, passID, isPrimary, isEnabled, disToken, accessToken, query);
}

/*
    body: {
        passID
    }
*/
async function removePass(body, userID) {
    var passID = body["passID"];
    await passManager.removePass(userID, passID, query);
}

module.exports = {
    getUserPasses: getUserPasses,
    getPartyPasses: getPartyPasses,
    updateSplitters: updateSplitters,
    updatePass: updatePass,
    removePass: removePass
}