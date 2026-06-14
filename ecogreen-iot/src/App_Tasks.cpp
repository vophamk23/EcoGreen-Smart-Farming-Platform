/*
 * app_tasks.cpp - Triển khai các task cho Cooperative Scheduler
 */

#include "app_tasks.h"
#include "sensor_handler.h"
#include "actuator_handler.h"
#include "lcd_display.h"
#include "global_vars.h"
#include "config.h"
#include "iot_bridge.h"
#include "ntp_sync.h"
#include <WiFi.h>

// Task 1: ĐỌC CẢM BIẾN KHÔNG KHÍ (2 giây)
void Task_ReadAirSensors(void)
{
    readDHT();
    readLightSensor();
}

// Task 2: ĐỌC CẢM BIẾN ĐẤT (5 giây)
void Task_ReadSoilSensor(void)
{
    readSoilMoisture();
}

// Task 3: CẬP NHẬT LCD (500ms)
void Task_UpdateLCD(void)
{
    updateLCDPage();
}

// Task 4: TỰ ĐỘNG CHUYỂN TRANG LCD (5 giây)
void Task_AutoSwitchLCDPage(void)
{
    nextLCDPage();
}

// Task 5: LOGIC ĐIỀU KHIỂN TỰ ĐỘNG (1 giây)
void Task_AutoControl(void)
{
    autoControlPump();
    autoControlFan();
}

// Task 6: CẬP NHẬT TRẠNG THÁI LED (500ms)
void Task_UpdateLEDStatus(void)
{
    autoControlLED();
}

// Task 7: KIỂM TRA CẢNH BÁO (1 giây)
void Task_CheckAlerts(void)
{
    updateAlerts();
}

// ============================================================================
// TASK 8: PUMP WATCHDOG (1 giây)
// Bảo vệ bơm: tắt cưỡng bức nếu chạy quá PUMP_MAX_ON_TIME_MS
// Reset cooldown sau PUMP_COOLDOWN_MS
// ============================================================================
void Task_PumpWatchdog(void)
{
    if (g_pumpState)
    {
        unsigned long elapsed = millis() - g_pumpStartTime;

        // Ưu tiên 1: tắt theo lịch (duration)
        if (g_scheduleOffTime > 0 && millis() >= g_scheduleOffTime)
        {
            Serial.println("[WATCHDOG] Schedule duration ended -> pump OFF");
            g_scheduleOffTime = 0;
            g_scheduleTriggered = false; // Reset flag sau khi lịch tưới kết thúc
            pumpOff();
            return;
        }

        // Ưu tiên 2: force OFF theo PUMP_MAX_ON_TIME_MS
        // Chỉ áp dụng khi ở chế độ AUTO, KHÔNG phải bật thủ công, và KHÔNG có lịch đang chạy
        if (g_autoMode && !g_pumpManual && g_scheduleOffTime == 0 && elapsed >= g_pumpMaxOnMs)
        {
            Serial.printf("[WATCHDOG] Pump ran %lus >= max %lus (AUTO) -> force OFF\n",
                          elapsed / 1000,
                          (unsigned long)(g_pumpMaxOnMs / 1000));
            g_scheduleOffTime = 0;
            g_scheduleTriggered = false; // Reset flag khi watchdog force OFF
            pumpOff();
        }
    }
    else
    {
        // Bơm đã tắt → reset scheduleOffTime và scheduleTriggered nếu còn thừa
        if (g_scheduleOffTime > 0)
            g_scheduleOffTime = 0;
        if (g_scheduleTriggered)
            g_scheduleTriggered = false; // Reset flag để đảm bảo luôn reset
    }

    // Cooldown timeout
    if (g_pumpCooldown)
    {
        if (millis() - g_pumpLastOffTime >= g_pumpCooldownMs)
        {
            g_pumpCooldown = false;
            Serial.println("[WATCHDOG] Pump cooldown ended");
        }
    }
}
// ============================================================================
// TASK 9 : GỬI TELEMETRY LÊN CLOUD (mỗi 5 giây)
// Đóng gói snapshot dữ liệu hiện tại vào queue cho CoreIoT task đọc
// ============================================================================
void Task_SendTelemetry(void)
{
    iotBridge_sendTelemetry();
    // Log nhẹ để debug không spam
    Serial.printf("[TELE] Queued: T=%.1f H=%.0f Soil=%.0f\n",
                  g_temperature, g_humidity, g_soilMoisture);
}

// ============================================================================
// TASK 10 : XỬ LÝ LỆNH RPC TỪ CLOUD (mỗi 200ms)
// Đọc các lệnh pending trong queue và thực thi
// Tách ra khỏi Task_AutoControl để không bị chặn bởi chế độ AUTO
// ============================================================================
void Task_ProcessRpc(void)
{
    iotBridge_processRpcCommands();
}

// ============================================================
// TASK 11: KIỂM TRA LỊCH TƯỚI (10 giây)
// So sánh giờ RTC với lịch đã lưu, bật bơm nếu khớp
// ============================================================
void Task_CheckSchedule(void)
{
    static uint32_t s_lastTriggeredMinute = 0xFFFFFFFF;

    // Snapshot trong lock
    bool enabled;
    uint8_t count;
    ScheduleEntry_t tmp[MAX_SCHEDULES];

    SENSOR_LOCK();
    enabled = g_scheduleEnabled;
    count = g_scheduleCount;
    memcpy(tmp, g_schedules, sizeof(ScheduleEntry_t) * count);
    SENSOR_UNLOCK();

    if (!enabled || count == 0 || g_pumpState || g_rtcError || !g_autoMode)
        return;

    // Lấy thời gian thực từ DS3231
    DateTime now = getRTCTime();
    uint32_t currentMinute = now.hour() * 60 + now.minute();
    if (currentMinute == s_lastTriggeredMinute)
        return;

    // Chặn lịch tưới tự động nếu g_weatherBlockPump = true (mưa)
    if (g_weatherBlockPump)
    {
        for (uint8_t i = 0; i < count; i++)
        {
            ScheduleEntry_t &s = tmp[i];
            if (!s.enabled)
                continue;
            if (!(s.days & (1 << now.dayOfTheWeek())))
                continue;
            if (s.hour != now.hour())
                continue;
            if (s.minute != now.minute())
                continue;

            Serial.printf("[SCHED] Weather block active - skip scheduled entry %d (%02d:%02d)\n",
                          i, s.hour, s.minute);
            s_lastTriggeredMinute = currentMinute;
            break;
        }
        return;
    }

    for (uint8_t i = 0; i < count; i++)
    {
        ScheduleEntry_t &s = tmp[i]; // ← dùng bản sao
        if (!s.enabled)
            continue;
        if (s.days != 0 && !(s.days & (1 << now.dayOfTheWeek())))
            continue;
        if (s.hour != now.hour())
            continue;
        if (s.minute != now.minute())
            continue;

        Serial.printf("[SCHED] Match entry %d: %02d:%02d, %d min\n",
                      i, s.hour, s.minute, s.duration);

        s_lastTriggeredMinute = currentMinute;
        
        // Bật cờ để vượt qua kiểm tra cooldown trong pumpOn()
        g_scheduleTriggered = true;
        pumpOn();

        if (s.duration > 0) {
            g_scheduleOffTime = millis() + ((unsigned long)s.duration * 60000UL);
        } else {
            // Tưới theo ngưỡng: reset cờ để các luồng tự động (watchdog & autoControl) tự tắt bơm
            g_scheduleTriggered = false;
            g_scheduleOffTime = 0;
        }
        break;
    }
}

// ============================================================
// Task 12: HEARTBEAT (5 giây) - in tóm tắt trạng thái hệ thống
// Dùng để monitor qua Serial console, không spam quá nhiều
// ============================================================
void Task_Heartbeat(void)
{
    // Lấy thời gian thực từ DS3231
    DateTime now = getRTCTime();

    Serial.println("========== GREENHOUSE STATUS ==========");
    Serial.printf("  Time: %02d/%02d/%04d %02d:%02d:%02d\n",
                  now.day(), now.month(), now.year(),
                  now.hour(), now.minute(), now.second());
    Serial.printf("  WiFi: %s  IP: %s\n",
                  WiFi.status() == WL_CONNECTED ? "OK" : "LOST",
                  WiFi.localIP().toString().c_str());
    Serial.println("---------------------------------------");
    Serial.printf("  Temp:%.1fC%s  Humi:%.0f%%\n",
                  g_temperature, g_dhtError ? "[ERR]" : "",
                  g_humidity);
    Serial.printf("  Soil:%.0f%%  Light:%.0flux(%s)\n",
                  g_soilMoisture, g_lightLux,
                  g_lightLux > 0 ? "BRIGHT" : "DARK");
    Serial.printf("  PUMP:%-3s  FAN:%-3s  LED_GROW:%-3s\n",
                  g_pumpState ? "ON" : "OFF",
                  g_fanState ? "ON" : "OFF",
                  g_ledGrowState ? "ON" : "OFF");
    Serial.printf("  Mode:%s  PumpManual:%s  Cooldown:%s\n",
                  g_autoMode ? "AUTO" : "MAN",
                  g_pumpManual ? "Y" : "N",
                  g_pumpCooldown ? "Y" : "N");
    Serial.printf("  Alert[T:%s H:%s S:%s L:%s]\n",
                  g_alertTemp ? "!" : "-",
                  g_alertHumidity ? "!" : "-",
                  g_alertSoil ? "!" : "-",
                  g_alertLight ? "!" : "-");
    Serial.printf("  PumpCount:%lu  TotalTime:%lus\n",
                  (unsigned long)g_pumpCount,
                  g_totalPumpTime / 1000);
    Serial.println("=======================================");
}
