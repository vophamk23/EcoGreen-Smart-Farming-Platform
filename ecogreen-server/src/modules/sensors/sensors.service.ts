import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LogsService } from '../logs/logs.service';
import { ActuatorsService } from '../actuators/actuators.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SmartLogicService } from '../smart-logic/smart-logic.service';

@Injectable()
export class SensorsService {
  private readonly logger = new Logger(SensorsService.name);

  // 🟢 Bộ nhớ đệm chống Spam tin nhắn Telegram
  // Key: Sensor_ID, Value: Thời gian gửi tin nhắn cảnh báo cuối cùng (millisecond)
  private alertCache: Map<string, number> = new Map();
  private readonly ALERT_COOLDOWN_MS = 1 * 60 * 1000; // Khoảng cách giữa 2 lần spam (5 phút)
  private lastSmartLogicSkipAlert: Map<string, number> = new Map();

  constructor(
    private prisma: PrismaService,
    private logsService: LogsService,
    private actuatorsService: ActuatorsService,
    private notificationsService: NotificationsService,
    private smartLogicService: SmartLogicService,
  ) {}

  async saveSensorData(macAddress: string, payload: any) {
    try {
      // 1. Tìm thiết bị (Gộp lấy luôn Cảm biến và Máy bơm để dùng sau)
      const device = await this.prisma.dEVICES.findUnique({
        where: { mac_address: macAddress },
        include: { sensors: true, actuators: true },
      });

      if (!device) return null; // Trả về null để AppController tiến hành Discovery

      const wasOffline = device.status === 'offline';

      const readingsToInsert: { Sensor_ID: string; value: number }[] = [];

      // 2. Map dữ liệu từ ESP32 gửi lên và ép kiểu an toàn
      for (const sensor of device.sensors) {
        let val = null;
        if (sensor.type === 'temperature')
          val = payload.temp ?? payload.temperature;
        else if (sensor.type === 'humidity')
          val = payload.humi ?? payload.humidity ?? payload.hum;
        else if (sensor.type === 'soil_moisture')
          val = payload.soil ?? payload.soil_moisture ?? payload.soilMoisture;
        else if (sensor.type === 'light')
          val =
            payload.light ??
            payload.lightLux ??
            payload.light_lux ??
            payload.lux;

        if (val !== null && val !== undefined) {
          const parsedVal = parseFloat(val);
          if (!isNaN(parsedVal)) {
            readingsToInsert.push({
              Sensor_ID: sensor.Sensor_ID,
              value: parsedVal,
            });
          }
        }
      }

      if (readingsToInsert.length === 0) {
        // Cập nhật trạng thái online và thời gian nhìn thấy cuối cùng để tránh bị nhận diện offline nhầm do không đổi số liệu cảm biến
        await this.prisma.dEVICES.update({
          where: { Device_ID: device.Device_ID },
          data: { status: 'online', last_seen_at: new Date() },
        });
        return {
          success: true,
          wasOffline,
          deviceId: device.Device_ID,
          deviceName: device.name,
        };
      }

      // 3. TỐI ƯU HÓA 1: Lưu lịch sử và cập nhật thiết bị qua TRANSACTION
      await this.prisma.$transaction([
        this.prisma.sENSOR_READINGS.createMany({ data: readingsToInsert }),
        this.prisma.dEVICES.update({
          where: { Device_ID: device.Device_ID },
          data: { status: 'online', last_seen_at: new Date() },
        }),
      ]);

      // Kiểm tra chế độ AUTO/MANUAL từ payload ESP32
      // ESP32 có thể gửi: autoMode=false, autoMode="MAN", auto_mode="MANUAL", hoặc không gửi gì
      const rawMode = payload.autoMode ?? payload.auto_mode ?? payload.mode;
      const isAutoMode =
        rawMode !== false &&
        rawMode !== 'MAN' &&
        rawMode !== 'MANUAL' &&
        rawMode !== 0;
      this.logger.log(
        `[THRESHOLD-DEBUG] rawMode="${rawMode}" | isAutoMode=${isAutoMode}`,
      );

      // 4. Truy vấn toàn bộ Threshold bằng 1 lần gọi DB
      const sensorIds = readingsToInsert.map((r) => r.Sensor_ID);
      this.logger.log(
        `[THRESHOLD-DEBUG] Readings: ${JSON.stringify(readingsToInsert.map((r) => ({ id: r.Sensor_ID.slice(-6), val: r.value })))}`,
      );
      const thresholds = await this.prisma.tHRESHOLDS.findMany({
        where: { Sensor_ID: { in: sensorIds }, is_enabled: true },
      });

      this.logger.log(
        `[THRESHOLD-DEBUG] Found ${thresholds.length} threshold(s)`,
      );
      if (thresholds.length === 0) {
        return {
          success: true,
          wasOffline,
          deviceId: device.Device_ID,
          deviceName: device.name,
        };
      }

      // 5. Tìm trạng thái thiết bị chấp hành hiện tại
      const actuatorIds = thresholds.map((t) => t.Actuator_ID);
      const lastLogs = await this.prisma.aCTUATOR_LOGS.findMany({
        where: { Actuator_ID: { in: actuatorIds } },
        orderBy: { occurred_at: 'desc' },
      });

      const pumpStatusMap = new Map<string, boolean>();
      for (const log of lastLogs) {
        if (!pumpStatusMap.has(log.Actuator_ID)) {
          pumpStatusMap.set(log.Actuator_ID, log.action === 'ON');
        }
      }

      // 6. SO SÁNH NGƯỠNG, GỬI CẢNH BÁO, VÀ TỰ ĐỘNG ĐIỀU KHIỂN
      for (const reading of readingsToInsert) {
        const threshold = thresholds.find(
          (t) => t.Sensor_ID === reading.Sensor_ID,
        );
        if (!threshold) continue;

        const sensorName =
          device.sensors.find((s) => s.Sensor_ID === reading.Sensor_ID)?.name ||
          'Cảm biến';
        const actuatorID = threshold.Actuator_ID;
        const isCurrentlyOn = pumpStatusMap.get(actuatorID) || false;
        const actuatorInfo = device.actuators.find(
          (a) => a.Actuator_ID === actuatorID,
        );
        const actuatorName = actuatorInfo?.name || 'Thiết bị';
        const actuatorType = actuatorInfo?.type || 'pump';
        const isFan = actuatorType === 'fan';
        const actuatorIcon = isFan ? '🌀' : '💧';
        const actuatorLabel = isFan ? 'QUẠT' : 'MÁY BƠM';

        this.logger.log(
          `[THRESHOLD-DEBUG] "${sensorName}"=${reading.value} Min=${threshold.min_value} Max=${threshold.max_value} ` +
            `type=${actuatorType} isOn=${isCurrentlyOn} isAuto=${isAutoMode}`,
        );

        /**
         * ┌──────────────┬───────────────────────────┬───────────────────────────┐
         * │              │  Vượt MAX (quá nóng/sáng) │  Dưới MIN (quá khô/tối)  │
         * ├──────────────┼───────────────────────────┼───────────────────────────┤
         * │ 🌀 QUẠT      │  BẬT (làm mát)            │  TẮT (đã mát)            │
         * │ 💧 MÁY BƠM   │  TẮT (đủ nước rồi)        │  BẬT (cần tưới)          │
         * └──────────────┴───────────────────────────┴───────────────────────────┘
         */

        // ── Điều kiện BẬT: fan > max | pump < min ──────────────────────────────
        const shouldTurnOn = isFan
          ? reading.value > threshold.max_value // Quạt: bật khi QUÁ NÓNG
          : reading.value < threshold.min_value; // Bơm: bật khi QUÁ KHÔ

        // ── Điều kiện TẮT: fan < min | pump > max ──────────────────────────────
        const shouldTurnOff = isFan
          ? reading.value < threshold.min_value // Quạt: tắt khi đã mát
          : reading.value > threshold.max_value; // Bơm: tắt khi đủ nước

        let skipAutoPump = false;

        if (shouldTurnOn) {
          const alertLabel = isFan
            ? `nhiệt độ/ánh sáng QUÁ CAO (${reading.value} > Max ${threshold.max_value})`
            : `độ ẩm/đất QUÁ THẤP (${reading.value} < Min ${threshold.min_value})`;
          const alertEmoji = isFan ? '🔥' : '🏜️';

          this.logger.log(
            `[THRESHOLD-DEBUG] ⚡ SHOULD_ON (${actuatorType}): ${alertLabel}`,
          );

          // Chỉ tự BẬT khi AUTO và đang TẮT
          if (isAutoMode && !isCurrentlyOn) {
            if (!isFan) {
              try {
                const smartCheck = await this.smartLogicService.shouldSkipWatering(device.Device_ID);
                if (smartCheck.skip) {
                  skipAutoPump = true;
                  this.logger.log(`🛑 [THRESHOLD-AUTO] Bỏ qua tự động bật máy bơm ${actuatorID} do: ${smartCheck.reason}`);
                  
                  const lastAlertTime = this.lastSmartLogicSkipAlert.get(device.Device_ID) || 0;
                  const now = Date.now();
                  if (now - lastAlertTime > 15000) {
                    this.lastSmartLogicSkipAlert.set(device.Device_ID, now);

                    // Ghi log hoạt động hệ thống
                    await this.logsService.createSystemLog(
                      device.Device_ID,
                      'SMART_LOGIC_ACTION',
                      'warning',
                      `Bỏ qua tự động bật máy bơm do: ${smartCheck.reason}.`,
                    );

                    // Gửi tin nhắn Telegram cảnh báo chặn tự động bật do thời tiết
                    const config = await this.smartLogicService.getConfig(device.Device_ID);
                    const skipMsg =
                      `🌧️ <b>BỎ QUA TỰ ĐỘNG BẬT BƠM - TRỜI SẮP MƯA</b>\n\n` +
                      `🌱 Vườn: <b>${device.name}</b>\n` +
                      `⚠️ <b>${sensorName}</b>: <b>${reading.value}%</b> (Ngưỡng bật: &lt; ${threshold.min_value}%)\n` +
                      `📍 Khu vực: <b>${config.city_name}</b>\n` +
                      `🌧 Xác suất mưa: <b>${smartCheck.rainProbability}%</b> (ngưỡng ${config.rain_prob_threshold}%)\n\n` +
                      `🤖 <i>Độ ẩm đất thấp nhưng hệ thống đã tự động bỏ qua kích hoạt máy bơm do dự báo thời tiết sắp có mưa để tiết kiệm nước.</i>`;
                    
                    this.notificationsService.sendNotificationToDeviceOwner(device.Device_ID, skipMsg, false);
                  }
                }
              } catch (err) {
                this.logger.error(`❌ Lỗi kiểm tra Smart Logic khi tự động bật bơm: ${err.message}`);
              }
            }

            if (!skipAutoPump) {
              await this.logsService.createSystemLog(
                device.Device_ID,
                'WARNING',
                `CẢNH BÁO ${actuatorLabel}`,
                `${sensorName} ${alertLabel} → Tự động BẬT ${actuatorLabel}`,
              );
              await this.actuatorsService.toggle(actuatorID, true, 'AUTO_SYSTEM');
              pumpStatusMap.set(actuatorID, true);
            }
          }

          if (skipAutoPump) {
            continue;
          }

          // Gửi Telegram dù MANUAL hay AUTO (chống spam cooldown)
          const now = Date.now();
          const lastAlert = this.alertCache.get(reading.Sensor_ID) || 0;
          this.logger.log(
            `[THRESHOLD-DEBUG] CacheAge=${now - lastAlert}ms willSend=${now - lastAlert > this.ALERT_COOLDOWN_MS}`,
          );

          if (now - lastAlert > this.ALERT_COOLDOWN_MS) {
            // Ghi nhận cảnh báo vượt ngưỡng vào nhật ký hoạt động cứ mỗi 1 phút
            let logEventType = 'CẢNH BÁO';
            let logDescription = `${sensorName} vượt ngưỡng an toàn: ${reading.value}`;
            const sType = device.sensors.find((s) => s.Sensor_ID === reading.Sensor_ID)?.type;
            
            if (sType === 'temperature') {
              logEventType = 'CẢNH BÁO NHIỆT ĐỘ';
              logDescription = `Nhiệt độ hiện tại đang ở mức quá cao (${reading.value} °C), vượt ngưỡng an toàn!`;
            } else if (sType === 'soil_moisture') {
              logEventType = 'CẢNH BÁO ĐẤT KHÔ';
              logDescription = `Độ ẩm đất hiện tại đang ở mức quá thấp (${reading.value} %), dưới ngưỡng an toàn!`;
            } else if (sType === 'humidity') {
              logEventType = 'CẢNH BÁO ĐỘ ẨM';
              logDescription = `Độ ẩm không khí hiện tại đang ở mức quá thấp (${reading.value} %), dưới ngưỡng an toàn!`;
            } else if (sType === 'light') {
              logEventType = 'CẢNH BÁO ÁNH SÁNG';
              logDescription = `Cường độ ánh sáng hiện tại vượt ngưỡng an toàn (${reading.value} lux).`;
            }

            await this.logsService.createSystemLog(
              device.Device_ID,
              logEventType,
              'warning',
              logDescription,
            );

            const modeNote = isAutoMode
              ? ''
              : '\n🕹️ <i>Chế độ Thủ công — bạn cần tự bật thiết bị.</i>';
            const actionStatus =
              isAutoMode && !isCurrentlyOn
                ? 'Đã TỰ ĐỘNG BẬT!'
                : isAutoMode
                  ? 'Đang duy trì hoạt động...'
                  : 'Cần bật thủ công!';

            const msg =
              `${alertEmoji} <b>CẢNH BÁO VƯỢT NGƯỠNG!</b>\n\n` +
              `🌱 Vườn: <b>${device.name}</b>\n` +
              `⚠️ <b>${sensorName}</b>: <b>${reading.value}</b> (Ngưỡng ${isFan ? 'Max' : 'Min'}: ${isFan ? threshold.max_value : threshold.min_value})\n\n` +
              `${actuatorIcon} ${actuatorLabel} <b>${actuatorName}</b>: <i>${actionStatus}</i>` +
              modeNote;

            const sent = await this.notificationsService.sendTelegramMessage(
              device.User_ID,
              msg,
              true,
            );
            this.logger.log(`[THRESHOLD-DEBUG] Telegram sent=${sent}`);
            this.alertCache.set(reading.Sensor_ID, now);
          }
        } else if (shouldTurnOff) {
          const safeLabel = isFan
            ? `đã hạ xuống ${reading.value} (< Min ${threshold.min_value})`
            : `đã tăng lên ${reading.value} (> Max ${threshold.max_value})`;

          this.logger.log(
            `[THRESHOLD-DEBUG] ✅ SHOULD_OFF (${actuatorType}): ${safeLabel}`,
          );

          // Chỉ tự TẮT khi AUTO và đang BẬT
          if (isAutoMode && isCurrentlyOn) {
            await this.logsService.createSystemLog(
              device.Device_ID,
              'ACTION',
              `AN TOÀN — TẮT ${actuatorLabel}`,
              `${sensorName} ${safeLabel} → Tự động TẮT ${actuatorLabel}`,
            );
            await this.actuatorsService.toggle(
              actuatorID,
              false,
              'AUTO_SYSTEM',
            );
            pumpStatusMap.set(actuatorID, false);

            this.alertCache.delete(reading.Sensor_ID);

            const msg =
              `✅ <b>THÔNG BÁO AN TOÀN</b>\n\n` +
              `🌱 Vườn: <b>${device.name}</b>\n` +
              `📉 <b>${sensorName}</b> ${safeLabel}\n\n` +
              `${actuatorIcon} ${actuatorLabel} <b>${actuatorName}</b>: <i>Đã TỰ ĐỘNG TẮT.</i>`;

            await this.notificationsService.sendTelegramMessage(
              device.User_ID,
              msg,
              false,
            );
          }
        }
      }

      return {
        success: true,
        wasOffline,
        deviceId: device.Device_ID,
        deviceName: device.name,
      };
    } catch (error) {
      this.logger.error(
        `❌ Lỗi xử lý MQTT tại SensorsService: ${error.message}`,
      );
      return { success: false };
    }
  }

  async getSensorsByDevice(deviceId: string) {
    return this.prisma.sENSORS.findMany({ where: { Device_ID: deviceId } });
  }

  async getSensorReadings(
    sensorId: string,
    limit: number,
    startDate?: string,
    endDate?: string,
  ) {
    const whereClause: any = { Sensor_ID: sensorId };

    if (startDate || endDate) {
      whereClause.recorded_at = {};
      if (startDate) {
        whereClause.recorded_at.gte = new Date(startDate);
      }
      if (endDate) {
        whereClause.recorded_at.lte = new Date(endDate);
      }
      // Khi lọc theo ngày, có thể số lượng rất lớn, ưu tiên tăng limit hoặc không limit
      limit = limit > 500 ? limit : 2000;
    }

    const readings = await this.prisma.sENSOR_READINGS.findMany({
      where: whereClause,
      orderBy: { recorded_at: 'desc' },
      take: limit,
    });

    return readings.map((r) => ({
      ...r,
      Reading_ID: r.Reading_ID.toString(),
    }));
  }
}
