/*
 * 瑜伽球控制器：左侧 / 右侧 Nano 33 BLE 板载 IMU 数据采集
 *
 * 【1. 上传左侧板】保留下面的 SENSOR_LEFT，注释 SENSOR_RIGHT，然后上传。
 * 【2. 上传右侧板】注释 SENSOR_LEFT，取消 SENSOR_RIGHT 的注释，然后上传。
 * 两块板共用下面的采集代码，不需要复制或注释整段 setup() / loop()。
 * 左右以玩家面对控制器时的方向为准，建议在板子上贴 L / R 标签。
 *
 * 【3. 选择硬件版本】下面 IMU_REV2 = 0 表示原版，= 1 表示 Rev2。
 * Arduino IDE 开发板管理器：安装 Arduino Mbed OS Nano Boards。
 * 开发板选择 Arduino Nano 33 BLE，并选择当前要上传的板子的 USB 端口。
 * 库管理器：原版安装 Arduino_LSM9DS1；Rev2 安装 Arduino_BMI270_BMM150。
 * 官方版本说明：
 * https://support.arduino.cc/hc/en-us/articles/11729186296476
 *
 * 【4. 查看数据】各自通过 USB 接电脑；串口监视器选择 115200 波特率。
 * 每行 CSV：IMU,side,sequence,time_us,ax,ay,az,gx,gy,gz
 * 示例：IMU,L,0,123456,0.01000,-0.02000,1.00100,0.12000,-0.08000,0.03000
 * side：L 左侧 / R 右侧；sequence：有效采集帧编号，从 0 开始。
 * time_us：本板读取开始时的 micros()，单位微秒，约 71.6 分钟回绕。
 * ax/ay/az：加速度，单位 g，包含重力；静止时向量长度通常约为 1。
 * gx/gy/gz：角速度，单位 度/秒；静止时通常接近 0，有少量零偏。
 * 每行以换行结束。以 # 开头的是状态 / 错误信息，不是数据行。
 * 最多每秒输出 50 帧；串口未打开时不输出、不等待电脑。
 * sequence 在未连接电脑时仍递增；输出跳号可能代表期间没有串口连接。
 *
 * 【控制器轴向定义：左右两侧均按此标注】
 * X 轴 / ax：向内、向外移动（move inward / outward）。
 * Y 轴 / ay：向上、向下移动（up / down）。
 * Z 轴 / az：挤压、松开（squeeze in / out）。
 * 上述对应沿轴运动；gx/gy/gz 表示绕各轴旋转的角速度。
 * 各方向的正负号尚未指定，保留原始符号，以两块板实际安装后的读数确认。
 * ax/ay/az 是加速度，不是位移或挤压力；保持挤压时不一定持续有变化。
 *
 * 【安装与范围】数据保持板载传感器坐标，不做左右反号、滤波或去重力。
 * 安装时按上述定义确认板载轴方向；“左 / 右”标签不会自动对齐两板坐标。
 * 两板时钟独立，时间戳不能直接当作同步时间；暂不启用蓝牙或动作识别。
 * 游戏 Sensor lab 可读取此原始数据，用于归零、滤波和轴向测试；暂不自动触发游戏动作。
 * 先记录真实敲击 / 挤压数据，再进行坐标对齐、校准和分类。
 */

// ==================== 左侧代码选择：上传左板时保留 ====================
// #define SENSOR_LEFT

// ==================== 右侧代码选择：上传右板时取消注释 ====================
 #define SENSOR_RIGHT

// ==================== 板子版本：原版填 0，Rev2 填 1 ====================
#define IMU_REV2 1

#include <Arduino.h>
#include <math.h>

#if defined(SENSOR_LEFT) && defined(SENSOR_RIGHT)
#error "Select only one side: SENSOR_LEFT or SENSOR_RIGHT."
#elif defined(SENSOR_LEFT)
constexpr char SENSOR_SIDE = 'L';
#elif defined(SENSOR_RIGHT)
constexpr char SENSOR_SIDE = 'R';
#else
#error "Select a side: uncomment SENSOR_LEFT or SENSOR_RIGHT."
#endif

#if IMU_REV2 == 0
#include <Arduino_LSM9DS1.h>
#elif IMU_REV2 == 1
#include <Arduino_BMI270_BMM150.h>
#else
#error "IMU_REV2 must be 0 (original) or 1 (Rev2)."
#endif

// ==================== 左右共用：采样与 USB 串口输出 ====================
constexpr uint32_t OUTPUT_INTERVAL_US = 20000;  // 输出上限 50 Hz。
constexpr uint32_t SENSOR_TIMEOUT_MS = 1000;
bool imuReady = false;
bool serialWasConnected = false;
uint32_t lastSampleUs = 0;
uint32_t lastGoodSampleMs = 0;
uint32_t lastWarningMs = 0;
uint32_t sequence = 0;

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(115200);
  // 不使用 while (!Serial)，避免没开串口监视器时一直卡住。
  imuReady = IMU.begin();
  lastGoodSampleMs = millis();
}

void loop() {
  const uint32_t nowMs = millis();
  const bool serialConnected = static_cast<bool>(Serial);

  // 每次打开串口都提供侧别、状态和列名，便于确认两块板没有烧反。
  if (serialConnected && !serialWasConnected) {
    Serial.print("# side=");
    Serial.print(SENSOR_SIDE);
    Serial.println(imuReady ? " imu=ready" : " imu=init_failed");
    Serial.println("# IMU,side,sequence,time_us,ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps");
  }
  serialWasConnected = serialConnected;

  const bool sensorFault = !imuReady ||
      static_cast<uint32_t>(nowMs - lastGoodSampleMs) >= SENSOR_TIMEOUT_MS;
  // 正常时 LED 常亮；初始化失败或超过 1 秒没读到有效数据时闪烁。
  digitalWrite(LED_BUILTIN, sensorFault ? ((nowMs / 250) % 2) : HIGH);
  if (sensorFault && serialConnected &&
      static_cast<uint32_t>(nowMs - lastWarningMs) >= SENSOR_TIMEOUT_MS) {
    lastWarningMs = nowMs;
    Serial.println(imuReady ? "# ERROR: no valid IMU samples" :
        "# ERROR: IMU init failed; check IMU_REV2 and library, then reset");
  }
  if (!imuReady) return;

  const uint32_t nowUs = micros();
  if (static_cast<uint32_t>(nowUs - lastSampleUs) < OUTPUT_INTERVAL_US) return;
  // 两个传感器都有新数据才读取，不把上次的值冒充新采样。
  if (!IMU.accelerationAvailable() || !IMU.gyroscopeAvailable()) return;

  // 数据顺序：ax（内外移动）、ay（上下移动）、az（挤压松开），随后为三轴角速度。
  float values[6];
  const uint32_t sampleUs = micros();
  const int accelerationRead = IMU.readAcceleration(values[0], values[1], values[2]);
  const int gyroscopeRead = IMU.readGyroscope(values[3], values[4], values[5]);
  lastSampleUs = sampleUs;
  if (!accelerationRead || !gyroscopeRead) return;
  for (float value : values) {
    if (!isfinite(value)) return;
  }
  lastGoodSampleMs = millis();
  const uint32_t sampleSequence = sequence++;
  if (!serialConnected) return;

  Serial.print("IMU,");
  Serial.print(SENSOR_SIDE);
  Serial.print(',');
  Serial.print(sampleSequence);
  Serial.print(',');
  Serial.print(sampleUs);
  for (float value : values) {
    Serial.print(',');
    Serial.print(value, 5);
  }
  Serial.println();
}
