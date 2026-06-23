/**
 * 腾讯云 SMS 短信服务封装
 */

require('dotenv').config();
const tencentcloud = require('tencentcloud-sdk-nodejs-sms');

const SmsClient = tencentcloud.sms.v20210111.Client;

const client = new SmsClient({
  credential: {
    secretId:  process.env.TENCENT_SECRET_ID,
    secretKey: process.env.TENCENT_SECRET_KEY,
  },
  region: 'ap-guangzhou',   // 短信服务不区分地域，写 ap-guangzhou 即可
  profile: {
    httpProfile: {
      endpoint: 'sms.tencentcloudapi.com',
      reqTimeout: 10,
    },
  },
});

/**
 * 发送短信验证码
 * @param {string} phone  手机号（不含 +86）
 * @param {string} code   6位验证码
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function sendSmsCode(phone, code) {
  try {
    const params = {
      SmsSdkAppId:  process.env.TENCENT_SMS_SDK_APP_ID,
      SignName:     process.env.TENCENT_SMS_SIGN_NAME,
      TemplateId:   process.env.TENCENT_SMS_VERIFY_TEMPLATE_ID,
      // 模板变量：{1}=验证码  {2}=有效期（分钟）
      TemplateParamSet: [code, '5'],
      PhoneNumberSet:   [`+86${phone}`],
    };

    const res = await client.SendSms(params);
    const status = res.SendStatusSet && res.SendStatusSet[0];

    if (status && status.Code === 'Ok') {
      console.log(`[SMS] ✅ 发送成功 → +86${phone}`);
      return { ok: true };
    } else {
      const msg = status ? status.Message : 'Unknown error';
      console.error(`[SMS] ❌ 发送失败 → +86${phone}: ${msg}`);
      return { ok: false, error: msg };
    }
  } catch (err) {
    console.error('[SMS] 请求异常:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendSmsCode };
