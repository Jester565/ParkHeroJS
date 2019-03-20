var passes = require('../dis/Pass');
var users = require('../core/User');
var moment = require('moment-timezone');

//add or update existing pass (can also be used to refresh pass information)
async function updatePass(userID, passID, isPrimary, isEnabled, accesssToken, tz, query) {
    var passInfo = await passes.getParsedPass(passID, accesssToken, tz);
    var primaryOwners = await query(`SELECT ownerID FROM ParkPasses WHERE id=? AND isPrimary=1`, [passID]);

    //Make sure only one primary pass for this id exists for all users
    var primaryOwnerID = (primaryOwners.length > 0)? primaryOwners[0].ownerID: null;
    if (isPrimary && primaryOwnerID != null) {
        if (primaryOwnerID != userID) {
            throw "This pass is already primary on someone elses account!";
        } else {
            //If we own the primary pass, then make it non-primary
            await query(`UPDATE ParkPasses SET isPrimary=0 WHERE ownerID=? AND id=?`, [userID, passID]);
        }
    }
    //First pass is primary by default if its not primary already
    if (isPrimary == null && primaryOwnerID == null) {
        var userPasses = await query(`SELECT id FROM ParkPasses WHERE ownerID=?`, [userID]);
        if (userPasses.length == 0) {
            isPrimary = true;
        }
    }
    var maxPassDateStr = null;
    if (passInfo.hasMaxPass) {
        maxPassDateStr = moment().tz(tz).subtract(4, 'hours').format("YYYY-MM-DD HH:mm:ss");
    }
    var expireDTStr = (passInfo.expireDT)? passInfo.expireDT.format("YYYY-MM-DD HH:mm:ss"): null;
    await query(`INSERT INTO ParkPasses VALUES ?
        ON DUPLICATE KEY UPDATE
        isPrimary=?, isEnabled=?, expirationDT=?, maxPassDate=?`,
        [[[passInfo.passID, userID, passInfo.name, passInfo.disID, passInfo.type, expireDTStr, isPrimary, isEnabled, maxPassDateStr]]
        , isPrimary, isEnabled, expireDTStr, maxPassDateStr]);
    
    return {
        id: passInfo.passID,
        name: passInfo.name,
        disID: passInfo.disID,
        type: passInfo.type,
        expirationDT: expireDTStr,
        isPrimary: isPrimary,
        isEnabled: isEnabled,
        hasMaxPass: passInfo.hasMaxPass
    };
}

async function getSplitters(groupID, query) {
    var splitters = await query(`SELECT userID FROM PassSplitters WHERE groupID=?`, [groupID]);
    var userIDs = [];
    for (var splitter of splitters) {
        userIDs.push(splitter.userID);
    }
    return userIDs;
}

async function splitPasses(groupID, userID, query) {
    await query(`INSERT INTO PassSplitters VALUES ?`, [[[groupID, userID]]]);
}

async function mergePasses(groupID, query) {
    await query(`DELETE FROM PassSplitters WHERE groupID=?`, [groupID]);
}

async function unsplitPasses(groupID, userID, query) {
    await query(`DELETE FROM PassSplitters WHERE groupID=? AND userID=?`, [groupID, userID]);
}

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
async function getPassesForUsers(userIDs, showDisabled, tz, query) {
    var enabledCondition = ``;
    if (!showDisabled) {
        enabledCondition = `AND isEnabled=1`;
    }
    var dateTime = moment().tz(tz);
    dateTime.subtract(4, 'hours')
    var passes = await query(`SELECT p.ownerID AS userID, p.id AS id, p.name AS name, p.disID AS disID, 
        p.type AS type, p.expirationDT AS expirationDT, p.isPrimary AS isPrimary, p.isEnabled AS isEnabled, p.maxPassDate=? AS hasMaxPass
        FROM ParkPasses p
        WHERE p.ownerID in (?) ${enabledCondition} ORDER BY p.isPrimary DESC, p.ownerID, p.id`, [dateTime.format('YYYY-MM-DD'), userIDs]);
    
    //Map passID to primary status
    var foundPasses = {};
    var usersToPasses = {};
    for (var pass of passes) {
        if (foundPasses[pass.id] == null || (foundPasses[pass.id] == false && pass.isPrimary)) {
            foundPasses[pass.id] = pass.isPrimary;
            if (usersToPasses[pass.userID] == null) {
                var user = await users.getUser(pass.userID, query);
                usersToPasses[pass.userID] = {
                    user: user,
                    passes: []
                };
            }
            usersToPasses[pass.userID].passes.push({
                id: pass.id,
                name: pass.name,
                disID: pass.disID,
                type: pass.type,
                expirationDT: moment(pass.expirationDT).tz(tz, true).format("YYYY-MM-DD HH:mm:ss"),
                isPrimary: pass.isPrimary,
                isEnabled: pass.isEnabled,
                hasMaxPass: pass.hasMaxPass
            });
        }
    }
    var userPassesArr = [];
    for (var userID in usersToPasses) {
        userPassesArr.push(usersToPasses[userID]);
    }
    return userPassesArr;
}

async function removePass(userID, passID, query) {
    await query(`DELETE FROM ParkPasses WHERE id=? AND ownerID=?`, [passID, userID]);
}

module.exports = {
    updatePass: updatePass,
    getPassesForUsers: getPassesForUsers,
    removePass: removePass,
    getSplitters: getSplitters,
    splitPasses: splitPasses,
    mergePasses: mergePasses,
    unsplitPasses: unsplitPasses
};