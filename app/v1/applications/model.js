const app = require('../app');
const db = app.locals.db;
const flow = app.locals.flow;
const flame = app.locals.flame;
const log = app.locals.log;
const sql = require('./sql.js');

//takes SQL data and converts it into a response for the UI to consume
function constructFullAppObjs (res, next) {
    const appBase = res.appBase;
    const appCountries = res.appCountries;
    const appDisplayNames = res.appDisplayNames;
    const appPermissions = res.appPermissions;
    const appCategories = res.appCategories;
    const appServiceTypes = res.appServiceTypes;
    const appServiceTypeNames = res.appServiceTypeNames;
    const appServiceTypePermissions = res.appServiceTypePermissions;
    const appAutoApprovals = res.appAutoApprovals;
    const appBlacklist = res.appBlacklist;

    //convert appCategories and appAutoApprovals to hash by id
    const hashedCategories = {};
    const hashedAutoApproval = {};
    const hashedBlacklist = {};

    for (let i = 0; i < appCategories.length; i++) {
        hashedCategories[appCategories[i].id] = appCategories[i].display_name;
    }
    for (let i = 0; i < appAutoApprovals.length; i++) {
        hashedAutoApproval[appAutoApprovals[i].app_uuid] = true;
    }
    for (let i = 0; i < appBlacklist.length; i++) {
        hashedBlacklist[appBlacklist[i].app_uuid] = true;
    }

    //convert appBase to hash by id for fast assignment of other information
    const hashedApps = {};
    for (let i = 0; i < appBase.length; i++) {
        hashedApps[appBase[i].id] = appBase[i];
        hashedApps[appBase[i].id].uuid = hashedApps[appBase[i].id].app_uuid;
        hashedApps[appBase[i].id].short_uuid = hashedApps[appBase[i].id].app_short_uuid;

        hashedApps[appBase[i].id].category = {
            id: appBase[i].category_id,
            display_name: hashedCategories[appBase[i].category_id]
        };
        if (hashedAutoApproval[appBase[i].app_uuid]) {
            hashedApps[appBase[i].id].is_auto_approved_enabled = true;
        }
        else {
            hashedApps[appBase[i].id].is_auto_approved_enabled = false;
        }

        if (hashedBlacklist[appBase[i].app_uuid]) {
            hashedApps[appBase[i].id].is_blacklisted = true;
        } else {
            hashedApps[appBase[i].id].is_blacklisted = false;
        }

        delete hashedApps[appBase[i].id].app_uuid;
        delete hashedApps[appBase[i].id].app_short_uuid;

        hashedApps[appBase[i].id].countries = [];
        hashedApps[appBase[i].id].display_names = [];
        hashedApps[appBase[i].id].permissions = [];
        hashedApps[appBase[i].id].services = [];
    }
    // build countries
    for (let i = 0; i < appCountries.length; i++) {
        hashedApps[appCountries[i].id].countries.push({
            iso: appCountries[i].country_iso,
            name: appCountries[i].name
        });
    }
    // build display names
    for (let i = 0; i < appDisplayNames.length; i++) {
        hashedApps[appDisplayNames[i].id].display_names.push(appDisplayNames[i].display_text);
    }
    // build permissions
    for (let i = 0; i < appPermissions.length; i++) {
        hashedApps[appPermissions[i].id].permissions.push({
            key: appPermissions[i].permission_name,
            hmi_level: appPermissions[i].hmi_level,
            type: appPermissions[i].type
        });
    }
    // build app services
    for (let i = 0; i < appServiceTypes.length; i++) {
        var service = {
            "name": appServiceTypes[i].service_type_name,
            "display_name": appServiceTypes[i].display_name,
            "service_names": [],
            "permissions": []
        };

        for (let j = 0; j < appServiceTypeNames.length; j++) {
            if(appServiceTypeNames[j].service_type_name == appServiceTypes[i].service_type_name) {
                service.service_names.push(appServiceTypeNames[j].service_name);
            }
        }

        for (let k = 0; k < appServiceTypePermissions.length; k++) {
            if(appServiceTypePermissions[k].service_type_name == appServiceTypes[i].service_type_name) {
                service.permissions.push({
                    "app_id": appServiceTypes[i].app_id,
                    "function_id": appServiceTypePermissions[k].function_id,
                    "display_name": appServiceTypePermissions[k].display_name,
                    "name": appServiceTypePermissions[k].name,
                    "is_selected": appServiceTypePermissions[k].is_selected
                });
            }
        }

        hashedApps[appServiceTypes[i].app_id].services.push(service);
    }

    //convert the hash back to an array!
    let fullApps = [];
    for (let id in hashedApps) {
        fullApps.push(hashedApps[id]);
    }
    next(null, fullApps);
}

//store the information using a SQL transaction
function storeApp (appObj, next) {
    var storedApp = null;
    // process message groups synchronously (due to the SQL transaction)
    db.runAsTransaction(function (client, callback) {
        flame.async.waterfall([
            //stage 1: insert app info
            client.getOne.bind(client, sql.insertAppInfo(appObj)),
            //stage 2: insert countries, display names, permissions, and app auto approvals
            function (app, next) {
                log.info("New/updated app " + app.app_uuid + " added to the database");
                storedApp = app;
                const allInserts = [];
                if (appObj.countries.length > 0) {
                    allInserts.push(sql.insertAppCountries(appObj.countries, app.id));
                }
                if (appObj.display_names.length > 0) {
                    allInserts.push(sql.insertAppDisplayNames(appObj.display_names, app.id));
                }
                if (appObj.permissions.length > 0) {
                    allInserts.push(sql.insertAppPermissions(appObj.permissions, app.id));
                }
                if (appObj.services.length > 0) {
                    allInserts.push(sql.insertAppServices(appObj.services, app.id));
                    allInserts.push(sql.insertAppServiceNames(appObj.services, app.id));
                    allInserts.push(sql.insertStandardAppServicePermissions(appObj.services, app.id));
                }
                if (appObj.is_auto_approved_enabled) {
                    allInserts.push(sql.insertAppAutoApproval(appObj));
                }
                //execute all the sql statements. client.getOne needs client as context or the query will fail
                flame.async.series(flame.map(allInserts, client.getOne, client), next);
            },
            //stage 3: sync with shaid
            function (res, next) {
                if(!storedApp.version_id){
                    // skip sync with SHAID if no app version ID is present
                    next(null, null);
                    return;
                }
                app.locals.shaid.setApplicationApprovalVendor([storedApp], function(err, result){
                    next(err, res);
                });
            }
        ], function(err, res){
            if(err){
                callback(err, appObj.uuid);
            }
            else {
                callback(err, res);
            }
        });
    }, next);
}

module.exports = {
    constructFullAppObjs: constructFullAppObjs,
    storeApp: storeApp
}
