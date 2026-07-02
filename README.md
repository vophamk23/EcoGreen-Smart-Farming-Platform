# 🌿 EcoGreen IoT - Smart Greenhouse System

**Nông nghiệp thông minh trong tầm tay - giám sát và điều khiển nhà kính theo thời gian thực**

<div align="center">
<br/>

[![ESP32](https://img.shields.io/badge/ESP32-PlatformIO-blue?style=for-the-badge&logo=espressif&logoColor=white)](https://www.espressif.com/)
[![NestJS](https://img.shields.io/badge/Backend-NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![Next.js](https://img.shields.io/badge/Frontend-Next.js-000000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)
[![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![MQTT](https://img.shields.io/badge/Protocol-MQTT-660066?style=for-the-badge&logo=mqtt&logoColor=white)](https://mqtt.org/)
[![Docker](https://img.shields.io/badge/Infra-Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

</div>

## 📋 Mục lục

- [Tổng quan](#-tổng-quan)
- [Kiến trúc hệ thống](#-kiến-trúc-hệ-thống)
- [Tech Stack](#-tech-stack)
- [Cấu trúc monorepo](#-cấu-trúc-monorepo)
- [Tính năng](#-tính-năng)
- [Yêu cầu hệ thống](#-yêu-cầu-hệ-thống)
- [Hướng dẫn cài đặt & chạy](#-hướng-dẫn-cài-đặt--chạy)
- [Hướng dẫn flash ESP32](#-hướng-dẫn-flash-esp32)
- [Biến môi trường](#-biến-môi-trường)
- [API Reference](#-api-reference)
- [Xử lý lỗi thường gặp](#-xử-lý-lỗi-thường-gặp)
- [Sơ đồ luồng dữ liệu](#-sơ-đồ-luồng-dữ-liệu)

## Tổng quan

**EcoGreen IoT** là một hệ thống giám sát và điều khiển nhà kính thông minh hoàn chỉnh, kết hợp giữa **embedded firmware** trên ESP32, **cloud broker MQTT**, **backend NestJS** và **dashboard Next.js** theo dõi thời gian thực.

Toàn bộ luồng dữ liệu - từ cảm biến vật lý đến giao diện web - được thiết kế để hoạt động độc lập với mạng nội bộ. ESP32 chỉ cần kết nối internet là có thể gửi dữ liệu lên hệ thống.

## Kiến trúc hệ thống

```
┌────────────────────────────────────────────────────────────────────┐
│                         ESP32 Firmware                             │
│  Core 0: wifi_task · coreiot_task · webserver_task (FreeRTOS)      │
│  Core 1: Cooperative Scheduler — 13 tasks (sensors · actuators)    │
└────────────────────────┬───────────────────────────────────────────┘
                         │ MQTT publish
                         ▼
              ┌─────────────────────┐
              │   broker.emqx.io    │  ← Public MQTT broker (internet)
              │    (Port 1883)      │
              └──────────┬──────────┘
                         │ MQTT subscribe
                         ▼
┌───────────────────────────────────────────────────────────────────┐
│                    NestJS Backend (Port 3001)                     │
│                                                                   │
│  MqttService ──► PrismaService ──► PostgreSQL (Docker :5433)      │
│       │                                                           │
│  EventsGateway ─── WebSocket ──────────────────────────────────┐  │
│  AuthModule · UsersModule · AppController                      │  │
└────────────────────────────────────────────────────────────────┼──┘
                                                                 │ WebSocket
                                                                 ▼
                                         ┌──────────────────────────────┐
                                         │ Next.js Frontend (Port 3000) │
                                         │ Dashboard · SensorCards      │
                                         │ Real-time charts & control   │
                                         └──────────────────────────────┘
```

> **Lưu ý mạng:** ESP32 kết nối đến `broker.emqx.io` (public internet) — **không cần cùng mạng LAN** với backend. Browser và backend cần **cùng mạng LAN** để truy cập dashboard.

## 🛠️ Tech Stack

| Layer        | Công nghệ                              | Mục đích                              |
| ------------ | -------------------------------------- | ------------------------------------- |
| **Firmware** | ESP32 · PlatformIO · Arduino Framework | Embedded MCU, FreeRTOS dual-core      |
| **Protocol** | MQTT (broker.emqx.io + Mosquitto)      | Truyền dữ liệu IoT                    |
| **Backend**  | NestJS · TypeScript                    | REST API + WebSocket gateway          |
| **Database** | PostgreSQL · Prisma ORM                | Lưu trữ dữ liệu cảm biến & người dùng |
| **Frontend** | Next.js 15 · TypeScript · Tailwind CSS | Dashboard web thời gian thực          |
| **Infra**    | Docker · Docker Compose                | PostgreSQL + Mosquitto container      |
| **Auth**     | JWT · Guard NestJS                     | Bảo mật API                           |

## Cấu trúc monorepo

```
ecogreen/
├── ecogreen-iot/                   # ESP32 Firmware (PlatformIO)
│   ├── src/
│   │   ├── main.cpp                # Entry point, dual-core setup
│   │   ├── App_Tasks.cpp           # 13 cooperative scheduler tasks
│   │   ├── sensor_handler.cpp      # DHT11, LDR, Soil sensor
│   │   ├── actuator_handler.cpp    # Relay pump, fan, NeoPixel
│   │   ├── webserver_greenhouse.cpp# ESPAsyncWebServer
│   │   ├── iot_bridge.cpp          # MQTT / CoreIoT integration
│   │   ├── scheduler.cpp           # Cooperative scheduler engine
│   │   └── ...
│   ├── include/                    # Header files (config.h, global_vars.h…)
│   ├── data/                       # LittleFS web UI (HTML/CSS/JS)
│   │   └── info.dat                # WiFi & MQTT credentials (JSON)
│   ├── lib/                        # Local libraries (DHT, LCD, RTClib…)
│   └── platformio.ini              # Build config
│
├── ecogreen-server/                # NestJS Backend
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/               # JWT authentication
│   │   │   ├── users/              # User CRUD
│   │   │   └── prisma/             # Prisma service
│   │   ├── events.gateway.ts       # WebSocket gateway
│   │   ├── app.module.ts           # Root module + MQTT setup
│   │   └── main.ts                 # Bootstrap
│   ├── prisma/
│   │   ├── schema.prisma           # Database schema
│   │   └── migrations/             # Migration history
│   ├── mosquitto/config/           # Mosquitto broker config
│   ├── docker-compose.yml          # PostgreSQL + Mosquitto containers
│   └── package.json
│
└── ecogreen-client/                # Next.js Frontend
    ├── src/
    │   ├── app/
    │   │   ├── dashboard/page.tsx
    │   │   └── layout.tsx
    │   ├── features/dashboard/     # DashboardView, SensorCard
    │   ├── services/               # api.ts, user.service.ts
    │   ├── components/             # Shared UI components
    │   └── types/                  # TypeScript interfaces
    └── package.json
```

## Tính năng

| Tính năng                   | Mô tả                                                                  |
| --------------------------- | ---------------------------------------------------------------------- |
| **MQTT IoT pipeline**       | ESP32 publish dữ liệu lên broker công cộng, NestJS subscribe và lưu DB |
| **Real-time dashboard**     | WebSocket gateway đẩy dữ liệu cảm biến lên browser ngay khi nhận       |
| **Multi-sensor monitoring** | Nhiệt độ, độ ẩm (DHT11), ánh sáng (LDR), độ ẩm đất (capacitive ADC)    |
| **Remote actuator control** | Điều khiển bơm nước, quạt, LED grow từ dashboard                       |
| **Auto control logic**      | ESP32 tự điều khiển thiết bị theo ngưỡng cảm biến (không cần server)   |
| **Scheduler**               | Lập lịch tưới theo ngày/giờ, lưu vào LittleFS                          |
| **Authentication**          | JWT login, bảo vệ API và dashboard                                     |
| **Docker infra**            | PostgreSQL + Mosquitto chạy container, setup 1 lệnh                    |
| **OTA update**              | Cập nhật firmware ESP32 qua browser (ElegantOTA)                       |
| **Embedded web server**     | Giao diện web nhúng phục vụ từ chính ESP32 (LittleFS)                  |

## Yêu cầu hệ thống

| Công cụ                       | Phiên bản tối thiểu   |
| ----------------------------- | --------------------- |
| Node.js                       | 18.x trở lên          |
| Docker Desktop                | 24.x trở lên          |
| Python                        | 3.8+ (cho PlatformIO) |
| VSCode + PlatformIO extension | Mới nhất              |
| Git                           | Bất kỳ                |

## PHƯƠNG ÁN 1: KHỞI CHẠY TỰ ĐỘNG BẰNG SCRIPT (KHUYÊN DÙNG)

Dự án đã tích hợp sẵn script PowerShell để tự động hóa toàn bộ: dò IP mạng LAN, tạo file cấu hình môi trường, khởi chạy Docker, cài đặt dependencies, migrate cơ sở dữ liệu và khởi động các ứng dụng.

### Lệnh chạy duy nhất:

Mở PowerShell tại thư mục gốc của dự án (`Ecogreen`) và chạy:

```powershell
.\start.ps1
```

### Các bước tự động thực hiện:

1. **Docker**: Khởi động database PostgreSQL (`localhost:5433`) và local MQTT broker (`localhost:1883`).
2. **Cài đặt thư viện**: Tự động chạy `npm install` cho cả backend và frontend.
3. **Cấu hình IP LAN**: Tự động dò IP WiFi/LAN hiện tại của máy tính, tự động tạo/cập nhật `.env` (backend), `.env.local` (frontend) và `next.config.ts`.
4. **Prisma Migrate**: Đồng bộ cấu trúc bảng và migrate cơ sở dữ liệu.
5. **Khởi chạy ứng dụng**: Tự động mở 2 cửa sổ terminal mới chạy NestJS Backend và Next.js Frontend.

> **Mỗi khi đổi mạng WiFi hoặc IP thay đổi:** Bạn chỉ cần tắt các terminal cũ đi và chạy lại `.\start.ps1` (hoặc chạy lẻ `.\update-ip.ps1`) để tự động cập nhật IP mới mà không cần chỉnh sửa tay.

## PHƯƠNG ÁN 2: KHỞI CHẠY THỦ CÔNG (TỪNG BƯỚC)

Nếu muốn tự chạy từng bước thủ công, bạn thực hiện theo quy trình sau:

### BƯỚC 0 — Tạo cấu hình môi trường (Chỉ làm lần đầu)

1. Tạo file `.env` trong thư mục `ecogreen-server/`:

   ```env
   PORT=3001
   HOST=0.0.0.0
   DATABASE_URL="postgresql://admin:admin123@localhost:5433/ecogreendb"
   ```

2. Tạo file `.env.local` trong thư mục `ecogreen-client/`:
   ```env
   # Có thể dùng NEXT_PUBLIC_API_URL hoặc NEXT_PUBLIC_BACKEND_URL (Khuyên dùng NEXT_PUBLIC_API_URL để đồng bộ với script update-ip)
   NEXT_PUBLIC_API_URL=http://<IP_MÁY_TÍNH>:3001
   ```

### HƯỚNG DẪN LẤY CÁC KEY CÁ NHÂN (API KEYS / TOKENS)

Dự án sử dụng một số dịch vụ bên ngoài để gửi thông báo, trợ lý ảo AI và kiểm tra thời tiết. Dưới đây là hướng dẫn lấy các thông tin cấu hình này để điền vào file `.env` của `ecogreen-server`:

#### 1. Telegram Bot Token (`TELEGRAM_BOT_TOKEN`)

Dùng để gửi tin nhắn thông báo cảnh báo/lỗi hoặc hoạt động tới Telegram của người dùng:

- Mở ứng dụng Telegram, tìm kiếm bot chính thức **@BotFather** (có tích xanh).
- Gửi lệnh `/newbot` và đặt tên cho bot của bạn theo hướng dẫn của BotFather.
- Sau khi tạo xong, BotFather sẽ gửi cho bạn một mã token dạng: `1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ`.
- Sao chép mã token này và dán vào biến `TELEGRAM_BOT_TOKEN`.
- **Lưu ý**: Để nhận được thông báo thực tế, người dùng phải chat trực tiếp với bot này trên Telegram và nhấn **Start**, sau đó lấy Chat ID của họ (có thể lấy qua bot `@userinfobot` hoặc `@RawDataBot`) điền vào phần cài đặt thông báo trên giao diện Web Dashboard.

#### 2. OpenWeather API Key (`OPENWEATHER_API_KEY`)

Dùng để lấy dữ liệu thời tiết thực tế phục vụ cho chế độ Smart Logic (tự động bật/tắt lịch tưới dựa trên khả năng mưa):

- Truy cập trang web [OpenWeatherMap](https://openweathermap.org/) và đăng ký tài khoản miễn phí.
- Sau khi đăng nhập, truy cập vào mục **API keys** (ở góc phải tài khoản).
- Tạo một API key mới (hoặc dùng key mặc định có sẵn). Sao chép chuỗi mã và dán vào biến `OPENWEATHER_API_KEY`.
- _Lưu ý: Tài khoản mới đăng ký có thể mất từ 15 phút đến vài giờ để Key được kích hoạt hoàn toàn._

#### 3. Gemini AI API Key (`GEMINI_API_KEY`)

Dùng cho tính năng Trợ lý ảo AI tư vấn nông nghiệp thông minh:

- Truy cập trang [Google AI Studio](https://aistudio.google.com/).
- Đăng nhập bằng tài khoản Google của bạn.
- Nhấp vào nút **Create API key** (hoặc **Get API key**).
- Tạo một API key mới và sao chép chuỗi mã được cung cấp. Dán vào biến `GEMINI_API_KEY`.

#### 4. Google OAuth Credentials (`GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET`)

Dùng để cho phép người dùng đăng nhập nhanh bằng tài khoản Google (Google Login):

- Truy cập trang quản trị [Google Cloud Console](https://console.cloud.google.com/).
- Tạo một Project mới hoặc chọn Project hiện tại.
- Đi tới **APIs & Services** > **Credentials**.
- Nhấp vào **Configure Consent Screen** (nếu chưa từng cấu hình) và điền các thông tin cơ bản (Chọn User Type là External).
- Quay lại mục **Credentials**, chọn **Create Credentials** > **OAuth client ID**.
- Chọn loại ứng dụng (**Application type**) là **Web application**.
- Tại phần **Authorized JavaScript origins**, thêm: `http://localhost:3001` (và `http://localhost:3000`).
- Tại phần **Authorized redirect URIs**, thêm đường dẫn callback của server: `http://localhost:3001/v1/auth/google/callback` (Nếu chạy IP LAN thực tế, bạn cần thêm callback tương ứng với IP LAN, ví dụ: `http://192.168.1.16:3001/v1/auth/google/callback`).
- Nhấn **Create** để nhận `Client ID` và `Client Secret`. Dán vào các biến tương ứng trong `.env`.

#### 5. Supabase Database Link (`DATABASE_URL` & `DIRECT_URL`)

Dùng nếu bạn muốn chuyển từ cơ sở dữ liệu chạy Docker nội bộ (`localhost`) sang cơ sở dữ liệu đám mây Supabase miễn phí:

- Đăng nhập vào [Supabase](https://supabase.com/).
- Tạo một dự án mới (New Project) và thiết lập mật khẩu cơ sở dữ liệu (`Database Password`).
- Đi tới **Project Settings** > **Database**.
- Cuộn xuống mục **Connection string** và chọn tab **URI**.
  - Chọn chế độ **Transaction Mode** (thường dùng cổng `6543`) để lấy liên kết dán vào `DATABASE_URL` (ví dụ: `postgresql://...:6543/postgres?pgbouncer=true`).
  - Chọn chế độ **Session Mode** (thường dùng cổng `5432`) để lấy liên kết dán vào `DIRECT_URL` (ví dụ: `postgresql://...:5432/postgres`).
- Thay thế chuỗi `[YOUR-PASSWORD]` trong cả hai liên kết trên bằng mật khẩu thực tế của bạn.

---

### BƯỚC 0.5 — Khi đổi mạng WiFi (Đổi IP)

> Thực hiện mỗi khi bạn đổi mạng hoặc IP máy tính thay đổi.

1. **Tìm IP mới:**
   Mở terminal chạy lệnh:

   ```bash
   ipconfig
   ```

   Tìm dòng **IPv4 Address** của card mạng đang kết nối WiFi (ví dụ: `192.168.1.18`).

2. **Cập nhật `.env.local` trong `ecogreen-client/`:**

   ```env
   NEXT_PUBLIC_API_URL=http://<IP_MỚI>:3001
   ```

3. **Cập nhật `next.config.ts` trong `ecogreen-client/`:**
   Thêm hoặc cập nhật IP mới vào mục `allowedDevOrigins` để Next.js cho phép truy cập qua mạng LAN:

   ```typescript
   allowedDevOrigins: ['<IP_MỚI>'],
   ```

4. **Restart frontend:**
   ```bash
   npm run dev
   ```

> **Backend và ESP32 không cần sửa gì khi đổi mạng.** ESP32 kết nối đến broker công cộng (`broker.emqx.io`), hoàn toàn độc lập với IP LAN của máy tính.

### BƯỚC 1 — Khởi động Docker (PostgreSQL + MQTT)

```bash
cd ecogreen-server
docker compose up -d
```

_Kiểm tra trạng thái bằng lệnh `docker ps`. Cả hai container `ecogreen-postgres` và `ecogreen-mqtt` phải có trạng thái **Up**._

### BƯỚC 2 — Setup CSDL & Prisma (Chỉ làm lần đầu)

```bash
cd ecogreen-server
npm install
npx prisma generate
npx prisma migrate deploy
```

### BƯỚC 3 — Chạy Backend (NestJS)

```bash
cd ecogreen-server
npm run start:dev
```

_Đảm bảo log terminal in ra thông báo đã khởi tạo microservice, HTTP server và kết nối thành công tới Database qua Prisma._

### BƯỚC 4 — Chạy Frontend (Next.js)

Mở cửa sổ terminal mới:

```bash
cd ecogreen-client
npm install
npm run dev
```

Truy cập qua trình duyệt:

- **Tại máy chạy backend:** `http://localhost:3000`
- **Tại các thiết bị khác trong mạng LAN:** `http://<IP_MÁY_TÍNH>:3000`

### BƯỚC 5 — Flash ESP32 & Kiểm tra kết nối

1. Mở thư mục `ecogreen-iot/` bằng VSCode (yêu cầu đã cài đặt extension **PlatformIO**).
2. Kết nối board ESP32 vào máy tính và nhấn **Upload** để nạp firmware.
3. Mở **Serial Monitor** để kiểm tra log:
   ```text
   [WiFi] Connected! IP: 192.168.1.x
   [MQTT] Connecting to CoreIoT... OK
   [MQTT-LOCAL] Connecting to Mosquitto... OK
   [MQTT] Published: T=... H=... Soil=... Light=...
   [MQTT-LOCAL] connected=1
   ```

### BƯỚC 6 — Kiểm tra luồng dữ liệu MQTT

1. Kiểm tra log của local MQTT Broker:

   ```bash
   docker logs ecogreen-mqtt --tail 10
   ```

   Phải thấy các log kết nối từ client của ESP32 (`GH-LOCAL-xxxx`) và NestJS Backend.

2. Kiểm tra log nhận dữ liệu tại cửa sổ chạy NestJS:
   ```text
   📬 Telemetry từ ESP32: { temperature: ..., humidity: ..., ... }
   ```

## KIỂM TRA NHANH KHI CÓ LỖI

| Vấn đề                               | Cách khắc phục & Kiểm tra                                                                                    |
| :----------------------------------- | :----------------------------------------------------------------------------------------------------------- |
| **Docker chạy chưa**                 | Chạy lệnh `docker ps` để xem các container đang chạy.                                                        |
| **Lỗi log Mosquitto**                | Chạy lệnh `docker logs ecogreen-mqtt --tail 20` để xem chi tiết log của MQTT broker.                         |
| **Cổng 1883 có mở không**            | Chạy lệnh PowerShell: `Test-NetConnection -ComputerName <IP_MÁY> -Port 1883` để kiểm tra kết nối tới broker. |
| **Lỗi DB kết nối**                   | Đảm bảo thông tin kết nối trong file `.env` trùng với cấu hình Docker (mặc định là `admin:admin123`).        |
| **Dashboard không load / lỗi API**   | Kiểm tra IP LAN trong `.env.local` và `next.config.ts` có khớp với IP hiện tại (`ipconfig`) không.           |
| **Không hiển thị biểu đồ telemetry** | Kiểm tra ESP32 đã có internet để truyền dữ liệu lên broker MQTT chưa.                                        |
| **Cách tắt toàn bộ nhanh**           | Chạy file `.\stop.ps1` ở thư mục gốc của dự án.                                                              |

## LƯU Ý QUAN TRỌNG

- Trình duyệt và máy chạy Backend phải **ở cùng mạng LAN**.
- ESP32 chỉ cần **có kết nối Internet** (bất kỳ WiFi nào có mạng), không cần thiết phải chung mạng LAN với máy tính.
- Nếu cổng `3000` bị chiếm dụng, Next.js sẽ tự động chuyển sang cổng khác (ví dụ: `3001`), lúc đó hãy điều chỉnh file cấu hình và URL truy cập cho tương xứng.
- `npm install` và các lệnh khởi tạo Prisma chỉ cần chạy lần đầu tiên setup dự án.
