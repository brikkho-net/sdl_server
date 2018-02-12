//a repository of all the SQL statements
const sql = require('sql-bricks-postgres');
const config = require('../../../settings.js'); //configuration module
const log = require(`../../../custom/loggers/${config.loggerModule}/index.js`);
const db = require(`../../../custom/databases/${config.dbModule}/index.js`)(log); //pass in the logger module that's loaded

const getLanguages = sql.select('*').from('languages').toString();

module.exports = {
    insert: {
        messageGroups: insertMessageGroups,
        messageTexts: insertMessageTexts,
        languages: insertLanguages
    },
    getMessages: {
        status: getMessagesStatus,
        group: getMessageGroups,
        byCategory: getMessageByCategory,
        byId: getMessageById,
        groupById: getMessageGroupsById,
        categoryByLanguage: getMessageCategoriesByLanguage,
        categoryByMaxId: getMessageCategoriesByMaxId,
        byIds: getMessagesByIdsStagingFilter,
        groupsByIds: getMessageGroupsByIdsStagingFilter
    },
    getLanguages: getLanguages
}


//returns a combination of message group and message text entries in a flat structure.
//this is useful for generating the policy table, but not for returning info for the UI
function getMessagesStatus (isProduction) {
    if (isProduction) {
        return sql.select('*')
            .from('view_message_text_production')
            .toString();
    }
    else {
        return sql.select('*')
            .from('view_message_text_staging')
            .toString();
    }
}

//retrieve message group information such as categories
function getMessageGroups (isProduction, category) {
    let viewName;

    if (isProduction) {
        viewName = 'view_message_group_production';
    }
    else {
        viewName = 'view_message_group_staging';
    }

    let sqlString = sql.select('message_group.*')
        .from(viewName)
        .innerJoin('message_group', {
            'message_group.id': viewName + '.id'
        });

    if (category) {
        sqlString = sqlString.where({
            'message_group.message_category': category
        });
    }

    sqlString = sqlString
        .where(
            sql.or({
                'is_deleted': false,
                'status': 'STAGING'
            })
        )
        .orderBy('LOWER(message_group.message_category)');

    return sqlString.toString();
}

//retrieve all messages in a category
function getMessageByCategory (isProduction, category, preventStringify) {
    let sqlString;

    if (isProduction) {
        sqlString = sql.select('*')
            .from('view_message_text_production')
            .where({
                message_category: category
            })
            .orderBy('LOWER(message_group.message_category)');
    }
    else {
        sqlString = sql.select('*')
            .from('view_message_text_staging')
            .where({
                message_category: category
            })
            .orderBy('LOWER(message_group.message_category)');
    }

    if (!preventStringify) {
        sqlString = sqlString.toString();
    }

    return sqlString;
}

function getMessageById (id) {
    return sql.select('*')
        .from('message_text')
        .where({
            message_group_id: id
        })
        .toString();
}

function getMessageGroupsById (id) {
    return sql.select('*')
        .from('message_group')
        .where({
            id: id
        })
        .orderBy('LOWER(message_group.message_category)')
        .toString();
}

//given an array of ids, find all message texts with matching group ids that are in STAGING only
function getMessagesByIdsStagingFilter (ids) {
    return sql.select('message_text.*')
        .from('message_text')
        .innerJoin('message_group', {
            'message_group.id': 'message_text.message_group_id'
        })
        .where(
            sql.and(
                sql.in('message_group_id', ids),
                {
                    status: 'STAGING'
                }
            )
        )
        .toString();
}

//given an array of ids, find all message groups matching those that are in STAGING only
function getMessageGroupsByIdsStagingFilter (ids) {
    return sql.select('*')
        .from('message_group')
        .where(
            sql.and(
                sql.in('id', ids),
                {
                    status: 'STAGING'
                }
            )
        )
        .toString()
}

//return all categories of a certain language. may or may not exist
function getMessageCategoriesByLanguage (isProduction, languageCode) {
    if (isProduction) {
        return sql.select('*')
            .from('view_message_text_production')
            .where({
                language_id: languageCode
            })
            .toString();
    }
    else {
        return sql.select('*')
            .from('view_message_text_staging')
            .where({
                language_id: languageCode
            })
            .toString();
    }
}

//return all categories, like getMessageCategories, but also return text information from message_text
function getMessageCategoriesByMaxId (isProduction) {
    let viewName;
    if (isProduction) {
        viewName = "view_message_text_production";
    }
    else {
        viewName = "view_message_text_staging";
    }

    let messagesGroup = sql.select('max(id) AS id', 'message_category')
        .from(viewName)
        .groupBy('message_category');

    //always make sure the message category name is returned, because message_text doesn't have that info
    return sql.select('message_category', 'message_text.*')
        .from('(' + messagesGroup + ') mt')
        .innerJoin('message_text', {
            'message_text.id': 'mt.id'
        })
        .toString();
}

function insertMessageGroups (objs) {
    return objs.map(function (obj) {
        return sql.insert('message_group', {
            message_category: obj.message_category,
            status: obj.status,
            is_deleted: obj.is_deleted
        })
        .returning('*')
        .toString(); //return the results of the inserts
    });
}

function insertMessageTexts (objs) {
    return objs.map(function (obj) {
        return sql.insert('message_text', {
            language_id: obj.language_id,
            tts: obj.tts,
            line1: obj.line1,
            line2: obj.line2,
            text_body: obj.text_body,
            label: obj.label,
            message_group_id: obj.message_group_id
        })
        .toString();
    });
}

function insertLanguages (languages) {
    return languages.map(function (lang) {
        return sql.insert('languages', 'id')
            .select
                (
                `'${lang}' AS id`
                )
            .where(
                sql.not(
                    sql.exists(
                        sql.select('*')
                            .from('languages l')
                            .where({
                                'l.id': lang
                            })
                    )
                )
            )
            .toString();
    });
}