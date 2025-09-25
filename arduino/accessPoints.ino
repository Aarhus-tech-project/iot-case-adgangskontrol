#include <Wire.h>
#include "SparkFun_Qwiic_Keypad_Arduino_Library.h"
#include <ArduinoMqttClient.h>
#include <WiFiS3.h>
#include <Adafruit_PN532.h>
#include "arduinoAccessData.h"
#include <Adafruit_SH110X.h>

// const int doorId = 1;
// const char mqttId[] = "arduino1";

const int doorId = 4;
const char mqttId[] = "arduino2";

// -------------------------------------------------------------------- DISPLAY

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET 4
Adafruit_SH1106G display = Adafruit_SH1106G(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// -------------------------------------------------------------------- PN532 Shield (RFID/NFC reader)

#define PN532_IRQ   (2)
#define PN532_RESET (3)
Adafruit_PN532 nfc(PN532_IRQ, PN532_RESET);
uint8_t writeData[] = {'D', 'a', 't', 'a', 'i', 't', '2', '0', '2', '5', '!', 0, 0, 0, 0, 0};
uint8_t readData[16];
uint8_t uid[] = { 0, 0, 0, 0, 0, 0, 0 };

// -------------------------------------------------------------------- Keypad

KEYPAD keypad1;
int pinCounter = 0;
char keyInputs[] = {'0', '0', '0', '0', '0', '0'};

// -------------------------------------------------------------------- Wifi

WiFiClient wifiClient;
char ssid[] = SECRET_SSID;
char pswd[] = SECRET_NETPSWD;

// -------------------------------------------------------------------- MQTT

MqttClient mqttClient(wifiClient);
const char cardTopic[] = CARD_INPUT_TOPIC;
const char keypadTopic[] = KEY_INPUT_TOPIC;
const long subInterval = SUB_INTERVAL;
unsigned long previousMs = 0;

bool awaitResponse;

// -------------------------------------------------------------------- SETUP
void setup() { 
  Serial.begin(9600);
  Wire1.begin();
  Wire.begin();

  awaitResponse = false;
  delay(500);
  pinSetup();
  connectOled();
  connectKeyPad();
  connectRFIDShield();
  connectWifi();
  connectMQTT();

  mqttClient.subscribe(ACCESS_GRANTED_TOPIC + String(doorId));
  mqttClient.subscribe(ACCESS_DENIED_TOPIC + String(doorId));
  mqttClient.setId(mqttId);
}

// -------------------------------------------------------------------- LOOP

void loop() {
  if (!awaitResponse) {
    pressButton();
    readCard();
  }

  int messageSize = mqttClient.parseMessage();

  if (mqttClient.connected() == 0){
    int connected = mqttClient.connected();
    Serial.print("Connected to mqtt: ");
    Serial.println(connected);
    pinMode(A3, OUTPUT);
    delay(1000);
  }

  if (WiFi.status() != 3) {
    Serial.print("Error. Wifi status: ");
    Serial.println(WiFi.status());
    delay(500);
    connectWifi();
  }

  if (messageSize) {
    Serial.println(messageSize);
    accessVisuals(mqttClient.messageTopic());
    awaitResponse = false;  
  }
}

// -------------------------------------------------------------------- Functions

void sendMqtt(uint8_t *uid) {
  awaitResponse = true;
  String uidString = String(uid[0]) + String(uid[1]) + String(uid[2]) + String(uid[3]);
  Serial.print("\nSending uid: ");
  Serial.println(uidString);
  Serial.println();
  mqttClient.beginMessage(CARD_INPUT_TOPIC, false, 1);
  mqttClient.print(uidString + ',' + doorId);
  mqttClient.endMessage();
  Serial.println("MQTT uid sent\n");
}

void sendMqtt(char *passCode) {
  awaitResponse = true;
  String passCodeString = String(passCode[0]) + 
    String(passCode[1]) + 
    String(passCode[2]) + 
    String(passCode[3]) + 
    String(passCode[4]) + 
    String(passCode[5]);
  Serial.print("\nSending code: ");
  Serial.println(passCodeString);
  Serial.println();
  mqttClient.beginMessage(KEY_INPUT_TOPIC);
  mqttClient.print(passCodeString + ',' + doorId);
  mqttClient.endMessage();
  Serial.println("MQTT pin sent\n");
}

void accessVisuals(arduino::String topic) {
  if (topic == ACCESS_GRANTED_TOPIC + String(doorId)) {
    Serial.println("OPEN");
    displaySuccess();
    openLight();
    display.clearDisplay();
    display.display();
  } else if (topic == ACCESS_DENIED_TOPIC + String(doorId)) {
    Serial.println("DENIED");
    displayWrongCode();
    deniedLight();
    display.clearDisplay();
    display.display();
  }
}

void openLight() {
  digitalWrite(A1, LOW);
  digitalWrite(A0, HIGH);
  delay(5000);
  digitalWrite(A0, LOW);
  digitalWrite(A1, HIGH);
}

void deniedLight() {
  displayWrongCode();
  digitalWrite(A1, LOW);
  digitalWrite(A2, HIGH);
  delay(5000);
  digitalWrite(A2, LOW);
  digitalWrite(A1, HIGH);
}

void pinSetup() {
  pinMode(A0, OUTPUT);
  pinMode(A1, OUTPUT);
  pinMode(A2, OUTPUT);

  digitalWrite(A0, LOW);
  digitalWrite(A1, HIGH);
  digitalWrite(A2, LOW);
}

void pressButton() {
  keypad1.updateFIFO();  // necessary for keypad to pull button from stack to readable register
  char button = keypad1.getButton();

  if (button == -1) {
    Serial.println("No keypad detected");
    delay(500);
  } else if (button != 0) {
    if (button == '#') {
      sendMqtt(keyInputs);
      resetPins();
    } else if (button == '*') {
      if (keyInputs[0] == '0' && keyInputs[1] == '1' && keyInputs[2] == '0' && keyInputs[3] == '1' && keyInputs[4] == '0' && keyInputs[5] == '1') {
        writeToCard(writeData);
      }
      resetPins();
      Serial.println();
    } else if ( pinCounter < 6) {
      keyInputs[pinCounter] = button;
      Serial.print('*');
      display.setCursor(25 + pinCounter * 15, 30);
      display.write(42);
      display.display();

      pinCounter++;
    }
  }
}

void displayWrongCode() {
  display.clearDisplay();
  display.setCursor(35, 30);
  display.write(68);
  display.setCursor(45, 30);
  display.write(69);
  display.setCursor(55, 30);
  display.write(78);
  display.setCursor(65, 30);
  display.write(73);
  display.setCursor(75, 30);
  display.write(69);
  display.setCursor(85, 30);
  display.write(68);
  display.display();
}

void displaySuccess() {
  display.clearDisplay();
  display.setCursor(30, 30);
  display.write(83);
  display.setCursor(40, 30);
  display.write(85);
  display.setCursor(50, 30);
  display.write(67);
  display.setCursor(60, 30);
  display.write(67);
  display.setCursor(70, 30);
  display.write(69);
  display.setCursor(80, 30);
  display.write(83);
  display.setCursor(90, 30);
  display.write(83);
  display.display();
}

void printEnteredPin() {
  Serial.print(keyInputs[0]);
  Serial.print(keyInputs[1]);
  Serial.print(keyInputs[2]);
  Serial.print(keyInputs[3]);
  Serial.print(keyInputs[4]);
  Serial.println(keyInputs[5]);
}

void resetPins() {
  display.clearDisplay();
  display.display();
  keyInputs[0] = '0';
  keyInputs[1] = '0';
  keyInputs[2] = '0';
  keyInputs[3] = '0';
  keyInputs[4] = '0';
  keyInputs[5] = '0';
  pinCounter = 0;
}

void writeToCard(uint8_t *data) {
  uint8_t success;
  uint8_t uid[] = { 0, 0, 0, 0, 0, 0, 0};
  uint8_t uidLength;

  Serial.println("Waiting for card to write to");
  success = nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, 10000);
  if (success) {
    Serial.println("Authenticating Card");
    uint8_t keyA[6] = { 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF };
    success = nfc.mifareclassic_AuthenticateBlock(uid, uidLength, 4, 0, keyA);

    if (success) {
      Serial.println("Writing to block 4");
      success = nfc.mifareclassic_WriteDataBlock(4, data);

      if (success) {
        Serial.println("Data written to block 4");
        resetPins();
      } else {
        Serial.println("Failed to write data to block 4");
        resetPins();
      }
    } else {
      Serial.println("Failed to authenticate card");
    }
  } else {
    Serial.println("Failed to read card");
  }

  delay(3000);
}

void readCard() {
  uint8_t success;
  uint8_t uidLength;                        // Length of the UID (4 or 7 bytes depending on ISO14443A card type)
  
  // Wait for an ISO14443A type cards (Mifare, etc.).  When one is found
  // 'uid' will be populated with the UID, and uidLength will indicate
  // if the uid is 4 bytes (Mifare Classic) or 7 bytes (Mifare Ultralight)
  success = nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, 100);

  if (success) {
    Serial.println("Found an ISO14443A card");
    Serial.print("  UID Length: ");Serial.print(uidLength, DEC);Serial.println(" bytes");
    Serial.print("  UID Value: ");
    nfc.PrintHex(uid, uidLength);
    Serial.println("");

    if (uidLength == 4) {
      Serial.println("Mifare Classic card (4 byte UID)");

      // Try to authenticate it for read/write access
      // Try with the factory default KeyA: 0xFF 0xFF 0xFF 0xFF 0xFF 0xFF
      Serial.println("Trying to authenticate block 4 with default KEYA value");
      uint8_t keya[6] = { 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF };

	  // Start with block 4 (the first block of sector 1)
	  // Sector 0 contains the manufacturer data
      success = nfc.mifareclassic_AuthenticateBlock(uid, uidLength, 4, 0, keya);

      if (success) {
        Serial.println("Sector 1 (Blocks 4..7) has been authenticated");
        uint8_t data[16];

        // Try to read the contents of block 4
        success = nfc.mifareclassic_ReadDataBlock(4, readData);

        if (success) {
          Serial.println("Reading Block 4:");
          nfc.PrintHexChar(readData, 16);
          Serial.println("");

          delay(1000); // TO BE REMOVED WHEN RESPONSES ARE GOTTEN
        } else {
          Serial.println("Unable to read the requested block. Try another key");
        }
      } else {
        Serial.println("Authentication failed. Try another key");
      }
    }
    sendMqtt(uid);
  } else {
    // Things to do if no card is detected (idle)
  }
  // Stuff that happens even when card is detected, but after data has been scanned
}

void connectWifi() {
  Serial.print("\nTrying to connect to WPA SSID: ");
  Serial.print(ssid);
  WiFi.disconnect();
  while (WiFi.begin(ssid, pswd) != WL_CONNECTED) {
    Serial.print('.');
    delay(2500);
    
  }
  delay(2500);
  while (WiFi.localIP() == INADDR_NONE) {
    delay(100);
  }

  arduino::String localIp = WiFi.localIP().toString();
  arduino::String errorIp = "0.0.0.0";

  while(localIp == errorIp) {
    Serial.print("\nErroneous IP: ");
    Serial.println(localIp);
    WiFi.begin(ssid, pswd);
    delay(3000);
    Serial.println(WiFi.status());
    localIp = WiFi.localIP().toString();
  }

  Serial.println("\nConnected");
  delay(2000);
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
  Serial.println(WiFi.gatewayIP());
  Serial.println();
  delay(2000);
}

void connectRFIDShield() {
  nfc.begin();

  uint32_t versiondata = nfc.getFirmwareVersion();
  if (! versiondata) {
    Serial.println("Didn't find PN53x board");
    while (1); 
  }

  Serial.print("Found chip PN5"); Serial.println((versiondata>>24) & 0xFF, HEX);
  Serial.print("Firmware ver. "); Serial.print((versiondata>>16) & 0xFF, DEC);
  Serial.print('.'); Serial.println((versiondata>>8) & 0xFF, DEC);
}

void connectMQTT() {
  Serial.println("Trying to connect to MQTT broker");
  while (!mqttClient.connected()) {
    if (!mqttClient.connect(SERVER_SITE)) {
      Serial.println("Mqtt connection failed.");
      Serial.println("Retrying..");
    }
    delay(1000);
  }

  Serial.println("Connected to MQTT broker\n");
}

void connectKeyPad() {
  if (!keypad1.begin(Wire1)) {
    Serial.println("Could not find keypad");
    while(1);
  }
  Serial.println("Found Keypad\n");
}

void connectOled() {
  Serial.println("Connecting OLED screen");
  display.begin(0x3c, true);
  display.setTextSize(1);
  display.setTextColor(SH110X_WHITE);
  display.display();
  display.clearDisplay();
  display.display();
  Serial.println("Screen connected");
}