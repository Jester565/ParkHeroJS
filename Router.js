var modules = {
    users: () => {
        return require('./api/UserApi');
    },
    rides: () => {
        return require('./api/RideApi');
    },
    resorts: () => {
        return require('./api/ResortApi');
    },
    multi: () => {
        return require('./api/MultiApi');
    }
};

exports.apiHandler = (event, context, callback) => {
    context.callbackWaitsForEmptyEventLoop = false;

    var moduleName = event["module"];
    var methodName = event["method"];
    var body = event.arguments;
    var userID = event.cognitoIdentityId;
    var mod = modules[moduleName]();
    mod[methodName](body, userID).then((data) => {
        callback(null, data);
    }).catch((err) => {
        console.warn("ERROR OCCURED in " + moduleName + "." + methodName + ": ", err);
        callback(err);
    });
};

exports.addRides = async (event, context, callback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    var rideAPI = modules['rides']();
    await rideAPI.addRideInformations();
    callback();
};

exports.addSchedules = async (event, context, callback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    var resortAPI = modules['resorts']();
    await resortAPI.addSchedules();
    callback();
};

exports.addForecasts = async (event, context, callback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    var resortAPI = modules['resorts']();

    await resortAPI.addForecasts();
    callback();
};

exports.addHistoricalRideTimes = async (event, context, callback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    var rideAPI = modules['rides']();

    await rideAPI.addHistoricalRideTimes();
    callback();
};

exports.saveLatestRideTimes = async (event, context, callback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    var rideAPI = modules['rides']();

    var body = JSON.parse(event.Records[0].Sns.Message);
    await rideAPI.updateRides(body);
    callback();
};

exports.verifyProfilePic = async (event, context, callback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    var userAPI = modules['users']();

    var bucket = event['Records'][0]['s3']['bucket']['name'];
    var objKey = decodeURIComponent(event['Records'][0]['s3']['object']['key']);
    await userAPI.updateProfilePic(bucket, objKey);
    callback();
};

exports.pollUpdates = async (event, context, callback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    var multiAPI = module['multi']();

    await multiAPI.pollUpdates();
}