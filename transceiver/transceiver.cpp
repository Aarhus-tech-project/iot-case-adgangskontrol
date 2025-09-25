#include <iostream>
#include <string>
#include <sstream>
#include <thread>
#include <chrono>
#include <algorithm>

#include <mqtt/async_client.h>
#include <mysql_connection.h>
#include <mysql_driver.h>
#include "accessData.h"

#include <cppconn/prepared_statement.h>

#include "bcrypt.h"

const int QOS = 1;
const int TIMEOUT = 10000;

bool messageReceived = false;
bool accessGranted = false;

std::string accessMethod;       // Method of access. Inserted into events
std::string accessResult;       // Denied or granted
std::string methodColumn;       // Column to be inserted into in events
std::string accessIdentifier;   // The actual UID or PIN to be written in the databse
std::string subscriberDoorId;


static std::stringstream getDoorUserAccess(std::string doorId, sql::Statement *statement) {
    std::string userAccessQuery =
        "SELECT allowed_user_ids FROM doors where id = " + doorId;
    auto userAccessRes = statement->executeQuery(userAccessQuery);
    userAccessRes->next();
    std::string usersWithAccess = userAccessRes->getString("allowed_user_ids");
    char eraseChars[] = "[]";
    for (unsigned int i = 0; i < strlen(eraseChars); ++i)
    {
        usersWithAccess.erase(std::remove(usersWithAccess.begin(), usersWithAccess.end(), eraseChars[i]), usersWithAccess.end());
    }
    std::stringstream userStringStream(usersWithAccess);
    return userStringStream;
}

class SubscriberCallback : public virtual mqtt::callback
{
public:
    void connection_lost(const std::string& cause) override
    {
        std::cout << "Connection lost: " << cause << "\n";
    }

    void message_delivered(mqtt::delivery_token_ptr message) {
        
    }

    void message_arrived(mqtt::const_message_ptr message) override
    {
        std::cout << "\nMessage arrived: " << message->get_payload_str() << "\n";

        std::string messageValue = message->get_payload_str();
        std::string userId = "0";
        std::istringstream stringStream(messageValue);
        std::string doorId;
        std::string identification;
        std::string streamToken;
        int splitCounter = 0;

        while (std::getline(stringStream, streamToken, ',')) {
            if (splitCounter == 0) {
                identification = streamToken;
                splitCounter++;
            }
            else if (splitCounter == 1) {
                doorId = streamToken;
                subscriberDoorId = doorId;
                splitCounter++;
            }
        }

        sql::mysql::MySQL_Driver* driver;
        sql::Connection* con;

        driver = sql::mysql::get_mysql_driver_instance();
        con = driver->connect(SERVER_ADDRESS, DATABASE_USER, DATABASE_PWD);
        con->setSchema(DATABASE);

        sql::Statement* statement;
        statement = con->createStatement();

        if (message->get_topic() == CARD_TOPIC) {
            std::cout << "Uid: " << identification << '\n';
            accessMethod = "RFID";
            accessIdentifier = identification;
            accessGranted = false;
            std::stringstream userStringStream = getDoorUserAccess(doorId, statement);

            std::string getUid =
                "SELECT uid, user_id FROM rfid_cards WHERE uid = '" + identification + "' AND active = 1";

            auto res = statement->executeQuery(getUid);
            if (!res->next()) {
                std::cout << "UID not recognized or inactive" << '\n';
                accessGranted = false;
                accessResult = "denied";
            }
            else {
                std::string uidString = res->getString("uid");
                userId = res->getString("user_id");
                std::cout << "UID recognized: " << uidString << '\n';
                std::string tokenString;
                while (std::getline(userStringStream, tokenString, ',')) {
                    std::cout << "tokenString: " << tokenString << '\n';
                    if (tokenString == userId) {
                        std::cout << "User has access to door\n";
                        accessGranted = true;
                        accessResult = "granted";
                        break;
                    }
                    accessGranted = false;
                    accessResult = "denied";
                }
            }
        }
        else if (message->get_topic() == KEY_TOPIC) {
            std::cout << "Pin: " << identification << '\n';
            accessMethod = "PIN";
            accessIdentifier = identification;
            accessGranted = false;

            std::string getPinsQuery =
                "SELECT pin_hash, user_id FROM pins WHERE active = 1";
            auto res = statement->executeQuery(getPinsQuery);

            std::stringstream userStringStream = getDoorUserAccess(doorId, statement);
            
            while (res->next()) {
                auto hashString = res->getString("pin_hash");
                userId = res->getString("user_id");
                std::cout << "Hash: " << hashString << ". UserId: " << userId << '\n';

                if (bcrypt::validatePassword(identification, hashString)) {
                    std::cout << "Pin recognized\n";
                    std::cout << "Pin active\n";
                    std::string tokenString;
                    while (std::getline(userStringStream, tokenString, ',')) {
                        std::cout << "tokenString: " << tokenString << '\n';
                        if (tokenString == userId) {
                            std::cout << "User has access to door\n";
                            accessGranted = true;
                            accessResult = "granted";
                            break;
                        }
                        if (accessGranted) {
                            break;
                        }
                    }
                    if (accessGranted == false) {
                        std::cout << "User does not have access to door\n";
                        break;
                    }
                }
                else {
                    std::cout << "Pin not recognized or inactive\n";
                    userId = "0";
                    accessResult = "denied";
                }
                if (accessGranted) {
                    break;
                }
            }
            if (!accessGranted) {
                std::cout << "Access not granted\n";
            }
        }
        messageReceived = true;

        if (accessMethod == "RFID") {
            methodColumn = "presented_uid";
        }
        else {
            methodColumn = "pin_sha";
            accessIdentifier = bcrypt::generateHash(accessIdentifier);
        }
        std::cout << "\nUser ID: " << userId << "\n";
        std::string eventQuery;

        if (userId == "0") {
            eventQuery =
                "INSERT INTO events (door_id, credential_type, " + methodColumn + ", result)" +
                "VALUES ( '" + doorId + "', '" + accessMethod + "', '" + accessIdentifier + "', '" + accessResult + "')";
        }
        else {
            eventQuery =
                "INSERT INTO events (door_id, user_id, credential_type, " + methodColumn + ", result)" +
                "VALUES ( '" + doorId + "', '" + userId + "', '" + accessMethod + "', '" + accessIdentifier + "', '" + accessResult + "')";
        }
        
        statement->execute(eventQuery);

        delete statement;
        delete con;
    }
};

int main(int argc, char* argv[])
{
    mqtt::async_client subClient(MQTT_SERVER_ADDRESS, SUBSCRIBER_ID);
    mqtt::connect_options connOpts;
    connOpts.set_keep_alive_interval(20);
    connOpts.set_clean_session(true);

    mqtt::async_client pubClient(MQTT_SERVER_ADDRESS, PUBLISHER_ID);
    mqtt::token_ptr pubConnectionToken = pubClient.connect(connOpts);
    pubConnectionToken->wait();

    try
    {
        SubscriberCallback subCallback;
        
        subClient.set_callback(subCallback);

        mqtt::token_ptr subConnectionToken = subClient.connect(connOpts);
        subConnectionToken->wait();

        mqtt::token_ptr cardSubToken = subClient.subscribe(CARD_TOPIC, QOS);
        mqtt::token_ptr keySubToken = subClient.subscribe(KEY_TOPIC, QOS);
        cardSubToken->wait();
        keySubToken->wait();

        while (true)
        {
            if (!messageReceived) {
                std::this_thread::sleep_for(std::chrono::milliseconds(50));
            }
            else {
                std::cout << "\nAccess Logic:\n";
                if (accessGranted) {
                    std::string reqMess = "granted";
                    mqtt::message_ptr pubMessage = mqtt::make_message(ACCESS_GRANTED_TOPIC + subscriberDoorId, reqMess, QOS, false);
                    pubClient.publish(pubMessage)->wait();
                    std::cout << "Granted\n";
                }
                else {
                    std::string reqMess = "denied";
                    mqtt::message_ptr pubMessage = mqtt::make_message(ACCESS_DENIED_TOPIC + subscriberDoorId, reqMess, QOS, false);
                    pubClient.publish(pubMessage)->wait();
                    std::cout << "Denied\n";
                }
                accessGranted = false;
                messageReceived = false;
            }
        }

        mqtt::token_ptr disconnectionToken = subClient.disconnect();
        disconnectionToken->wait();
    }
    catch (const mqtt::exception& ex)
    {
        std::cerr << "MQTT Exception: " << ex.what() << std::endl;
        return 1;
    }

    return 0;
}
