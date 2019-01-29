var passes = require('../dis/Pass');
var users = require('../core/User')
var moment = require('moment');

//add or update existing pass (can also be used to refresh pass information)
async function updatePass(userID, passID, isPrimary, isEnabled, accesssToken, tz, query) {
    var passInfo = await passes.getParsedPass(passID, accesssToken, tz);
    var userPasses = await query(`SELECT id, isPrimary FROM ParkPasses WHERE userID=?`, [userID]);
    if (isPrimary) {
        //Mark all other passes as non-primary
        for (var pass of userPasses) {
            if (pass.isPrimary) {
                await query('UPDATE ParkPasses SET isPrimary=0 WHERE id=? AND userID=?', [pass.id, userID]);
            }
        }
    } else if (userPasses.length == 0) {
        //If there are no other passes, isPrimary is always true
        isPrimary = true;
    }
    await query(`INSERT INTO ParkPasses VALUES ?
        ON DUPLICATE KEY UPDATE
        isPrimary=?, isEnabled=?, expirationDT=?`, 
        [[[passInfo.passID, userID, passInfo.name, passInfo.disID, passInfo.type, passInfo.expireDT, isPrimary, isEnabled, null]]
        , isPrimary, isEnabled, passInfo.expireDT]);
}

async function getPassesForUsers(userIDs, showDisabled, tz, query) {
    var enabledCondition = ``;
    if (!showDisabled) {
        enabledCondition = `AND isEnabled=1`;
    }
    var dateTime = moment().tz(tz);
    dateTime.subtract(4, 'hours')
    var passes = await query(`SELECT p.ownerID AS userID, p.id AS id, p.name AS name, p.disID AS disID, 
        p.type AS type, p.expirationDT AS expirationDT, p.isPrimary AS isPrimary, p.maxPassDate=? AS hasMaxPass
        FROM ParkPasses p
        WHERE p.ownerID in (?) ${enabledCondition}`, [dateTime.format('YYYY-MM-DD'), userIDs]);
    
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
                    passses: []
                };
            }
        }
        usersToPasses[userPass.userID].passes.push(userPass);
    }
    var userPassesArr = [];
    for (var userPasses in usersToPasses) {
        userPassesArr.push(userPasses);
    }
    return userPassesArr;
}

async function removePass(userID, passID, query) {
    await query(`DELETE FROM ParkPasses WHERE id=? AND ownerID=?`, [passID, userID]);
}

module.exports = {
    addPass: addPass,
    getPassesForUsers: getPassesForUsers,
    removePass: removePass
};