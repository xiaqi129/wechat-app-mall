const CONFIG = require('../../config.js')
const WXAPI = require('apifm-wxapi')
const AUTH = require('../../utils/auth')

Date.prototype.format = function(format) {
  var date = {
         "M+": this.getMonth() + 1,
         "d+": this.getDate(),
         "h+": this.getHours(),
         "m+": this.getMinutes(),
         "s+": this.getSeconds(),
         "q+": Math.floor((this.getMonth() + 3) / 3),
         "S+": this.getMilliseconds()
  };
  if (/(y+)/i.test(format)) {
         format = format.replace(RegExp.$1, (this.getFullYear() + '').substr(4 - RegExp.$1.length));
  }
  for (var k in date) {
         if (new RegExp("(" + k + ")").test(format)) {
                format = format.replace(RegExp.$1, RegExp.$1.length == 1
                       ? date[k] : ("00" + date[k]).substr(("" + date[k]).length));
         }
  }
  return format;
}

Page({
  data: {
    totalScoreToPay: 0,
    goodsList: [],
    isNeedLogistics: 0, // 是否需要物流信息
    yunPrice: 0,
    amountLogistics2: 0,
    allGoodsAndYunPrice: 0,
    goodsJsonStr: "",
    orderType: "", //订单类型，购物车下单或立即支付下单，默认是购物车， buyNow 说明是立即购买 
    pingtuanOpenId: undefined, //拼团的话记录团号

    hasNoCoupons: true,
    coupons: [],
    couponAmount: 0, //优惠券金额
    curCoupon: null, // 当前选择使用的优惠券
    curCouponShowText: '请选择使用优惠券', // 当前选择使用的优惠券
    peisongType: 'kd', // 配送方式 kd,zq 分别表示快递/到店自取
    remark: '',
    shopIndex: -1,
    pageIsEnd: false,


    bindMobileStatus: 0, // 0 未判断 1 已绑定手机号码 2 未绑定手机号码
    userScore: 0, // 用户可用积分
    deductionScore: '-1', // 本次交易抵扣的积分数， -1 为不抵扣，0 为自动抵扣，其他金额为抵扣多少积分
    shopCarType: 0, //0自营购物车，1云货架购物车
    dyopen: 0, // 是否开启订阅
    dyunit: 0, // 按天
    dyduration: 1, // 订阅间隔
    dytimes: 1, // 订阅次数
    dateStart: undefined, // 订阅首次扣费时间
    qisongjia: "", // 起送价
    disabledBuy: false,
    deliveryStatus: '', // 配送状态：normal正常, outOfRange超出配送范围, belowMinimum未达起送价
    deliveryMessage: '', // 配送提示信息
    deliveryButtonText: '', // 配送按钮显示文本
    userLatitude: null, // 用户地址纬度
    userLongitude: null, // 用户地址经度
    availableShops: [], // 可配送的门店列表
    minDate: new Date().getTime(),
    maxDate: new Date(2030, 10, 1).getTime(),
    currentDate: new Date().getTime(),
    formatter: (type, value) => {
      if (type === 'year') {
        return `${value}年`;
      } 
      if (type === 'month') {
        return `${value}月`;
      }
      if (type === 'day') {
        return `${value}日`;
      }
      if (type === 'hour') {
        return `${value}点`;
      }
      if (type === 'minute') {
        return `${value}分`;
      }
      return value;
    },
    cardId: '0' // 使用的次卡ID
  },
  async onShow() {
    if (this.data.pageIsEnd) {
      return
    }
    
    // 检查地址是否有变化，如果有变化则重新获取经纬度
    const res = await WXAPI.defaultAddress(wx.getStorageSync('token'))
    
    if (res.code == 0 && res.data.info) {
      const newAddress = res.data.info.address
      const oldAddress = this.data.curAddressData ? this.data.curAddressData.address : null
      
      // 如果地址发生变化，或者没有用户坐标，则重新获取
      if ((newAddress && newAddress !== oldAddress) || !this.data.userLatitude || !this.data.userLongitude) {
        const location = await this.getLocationByAddress(newAddress);
        this.setData({
          curAddressData: res.data.info,
          userLatitude: location.latitude,
          userLongitude: location.longitude
        });
        
        if (this.data.peisongType === 'kd') {
          await this.validateDeliveryRange();
        }
      }
    }
    
    this.doneShow()
  },
  async doneShow() {
    let goodsList = []
    let shopList = []
    const token = wx.getStorageSync('token')
    //立即购买下单
    if ("buyNow" == this.data.orderType) {
      var buyNowInfoMem = wx.getStorageSync('buyNowInfo');
      this.data.kjId = buyNowInfoMem.kjId;
      if (buyNowInfoMem && buyNowInfoMem.shopList) {
        goodsList = buyNowInfoMem.shopList
      }
    } else {
      //购物车下单
      if (this.data.shopCarType == 0) {//自营购物车
        var res = await WXAPI.shippingCarInfo(token)
        shopList = res.data.shopList
      } else if (this.data.shopCarType == 1) {//云货架购物车
        var res = await WXAPI.jdvopCartInfoV2(token)
        shopList = [{
          id: 0,
          name: '其他',
          hasNoCoupons: true,
          serviceDistance: 99999999
        }]
      }
      if (res.code == 0) {
        goodsList = res.data.items.filter(ele => {
          return ele.selected 
        })
        const shopIds = []
        goodsList.forEach(ele => {
          if (this.data.shopCarType == 1) {
            ele.shopId = 0
          }
          shopIds.push(ele.shopId)
        })
        shopList = shopList.filter(ele => {
          return shopIds.includes(ele.id)
        })
      }
    }
    shopList.forEach(ele => {
      ele.hasNoCoupons = true
    })
    const extRequired = []; // 必填项
    if (this.data.create_order_ext) {
      const _create_order_ext = JSON.parse(this.data.create_order_ext)
      goodsList.forEach(g => {
        Object.keys(_create_order_ext).forEach(k => {
          if (k.split(',').includes(g.goodsId + '')) {
            _create_order_ext[k].split(',').forEach(v => {
              if (!extRequired.includes(v)) {
                extRequired.push(v)
              }
            })
          }
        })
      })
    }
    const qisongjia = Number(wx.getStorageSync('qisongjia'))
    this.setData({
      qisongjia,
      shopList,
      goodsList,
      peisongType: this.data.peisongType,
      extRequired
    });
    this.initShippingAddress()
    this.userAmount()
  },

  onLoad(e) {
    const nowDate = new Date();
    let _data = {
      isNeedLogistics: 1,
      dateStart: nowDate.format('yyyy-MM-dd h:m:s'),
      orderPeriod_open: wx.getStorageSync('orderPeriod_open'),
      order_pay_user_balance: wx.getStorageSync('order_pay_user_balance'),
      zt_open_hx: wx.getStorageSync('zt_open_hx'),
      create_order_ext: wx.getStorageSync('create_order_ext'),
      needBindMobile: wx.getStorageSync('needBindMobile'),
    }
    if (e.orderType) {
      _data.orderType = e.orderType
    }
    if (e.pingtuanOpenId) {
      _data.pingtuanOpenId = e.pingtuanOpenId
    }
    if (e.shopCarType) {
      _data.shopCarType = e.shopCarType
    }
    this.setData(_data)
    this.getUserApiInfo()
    this.cardMyList()
  },
  async userAmount() {
    const res = await WXAPI.userAmount(wx.getStorageSync('token'))
    const order_pay_user_balance = wx.getStorageSync('order_pay_user_balance')
    if (res.code == 0) {
      this.setData({
        balance: order_pay_user_balance == '1' ? res.data.balance : 0,
        userScore: res.data.score
      })
    }
  },
  getDistrictId: function (obj, aaa) {
    if (!obj) {
      return "";
    }
    if (!aaa) {
      return "";
    }
    return aaa;
  },
  remarkChange(e) {
    this.data.remark = e.detail.value
  },
  async goCreateOrder() {
    this.setData({
      btnLoading: true
    })
    // 检测实名认证状态
    if (wx.getStorageSync('needIdCheck') == 1) {
      const res = await WXAPI.userDetail(wx.getStorageSync('token'))
      if (res.code == 0 && !res.data.base.isIdcardCheck) {
        wx.navigateTo({
          url: '/pages/idCheck/index',
        })
        this.setData({
          btnLoading: false
        })
        return
      }
    }
    const subscribe_ids = wx.getStorageSync('subscribe_ids')
    if (subscribe_ids) {
      wx.requestSubscribeMessage({
        tmplIds: subscribe_ids.split(','),
        complete: (e) => {
          this.createOrder(true)
        },
      })
    } else {
      this.createOrder(true)
    }
  },
  async createOrder(e) {
    // shopCarType: 0 //0自营购物车，1云货架购物车
    const loginToken = wx.getStorageSync('token') // 用户登录 token
    const postData = {
      token: loginToken,
      goodsJsonStr: this.data.goodsJsonStr,
      remark: this.data.remark,
      peisongType: this.data.peisongType,
      goodsType: this.data.shopCarType,
      cardId: this.data.cardId,
    }
    if (this.data.deductionScore != '-1') {
      postData.deductionScore = this.data.deductionScore
    }
    if (this.data.cardId == '0') {
      postData.cardId = ''
    }
    if (this.data.dyopen == 1) {
      const orderPeriod = {
        unit: this.data.dyunit,
        duration: this.data.dyduration,
        dateStart: this.data.dateStart,
        times: this.data.dytimes,
        autoPay: true
      }
      postData.orderPeriod = JSON.stringify(orderPeriod)
    }
    if (this.data.kjId) {
      postData.kjid = this.data.kjId
    }
    if (this.data.pingtuanOpenId) {
      postData.pingtuanOpenId = this.data.pingtuanOpenId
    }
    if (postData.peisongType == 'kd' && this.data.curAddressData && this.data.curAddressData.provinceId) {
      postData.provinceId = this.data.curAddressData.provinceId;
    }
    if (postData.peisongType == 'kd' && this.data.curAddressData && this.data.curAddressData.cityId) {
      postData.cityId = this.data.curAddressData.cityId;
    }
    if (postData.peisongType == 'kd' && this.data.curAddressData && this.data.curAddressData.districtId) {
      postData.districtId = this.data.curAddressData.districtId;
    }
    if (postData.peisongType == 'kd' && this.data.curAddressData && this.data.curAddressData.streetId) {
      postData.streetId = this.data.curAddressData.streetId;
    }
    if (this.data.shopCarType == 1) {
      // vop 需要地址来计算运费
      postData.address = this.data.curAddressData.address;
      postData.linkMan = this.data.curAddressData.linkMan;
      postData.mobile = this.data.curAddressData.mobile;
      postData.code = this.data.curAddressData.code;
    }
    if (e && this.data.isNeedLogistics > 0 && postData.peisongType == 'kd') {
      if (!this.data.curAddressData) {
        wx.hideLoading();
        wx.showToast({
          title: '请设置收货地址',
          icon: 'none'
        })
        this.setData({
          btnLoading: false
        })
        return;
      }
      if (postData.peisongType == 'kd') {
        postData.address = this.data.curAddressData.address;
        postData.linkMan = this.data.curAddressData.linkMan;
        postData.mobile = this.data.curAddressData.mobile;
        postData.code = this.data.curAddressData.code;
      }
    }
    if (this.data.curCoupon) {
      postData.couponId = this.data.curCoupon.id;
    }
    if (!e) {
      postData.calculate = "true";
    } else {
      if (postData.peisongType == 'zq' && this.data.shops && this.data.shopIndex == -1) {
        wx.showToast({
          title: '请选择自提门店',
          icon: 'none'
        })
        this.setData({
          btnLoading: false
        })
        return;
      }
      const extJsonStr = {}
      if (this.data.extRequired && this.data.extRequired.length > 0) {
        const extRequiredMap = this.data.extRequiredMap
        if (!extRequiredMap) {
          wx.showToast({
            title: '请填写必填项',
            icon: 'none'
          })
          this.setData({
            btnLoading: false
          })
          return;
        }
        this.data.extRequired.forEach(k => {
          if (!extRequiredMap[k]) {
            wx.showToast({
              title: '请填写' + k,
              icon: 'none'
            })
            this.setData({
              btnLoading: false
            })
            return;
          }
          extJsonStr[k] = extRequiredMap[k]
        })
      }
      if (postData.peisongType == 'zq') {
        if (!this.data.name) {
          wx.showToast({
            title: '请填写联系人',
            icon: 'none'
          })
          this.setData({
            btnLoading: false
          })
          return;
        }
        if (!this.data.mobile) {
          wx.showToast({
            title: '请填写联系电话',
            icon: 'none'
          })
          this.setData({
            btnLoading: false
          })
          return;
        }
        extJsonStr['联系人'] = this.data.name
        extJsonStr['联系电话'] = this.data.mobile
        postData.isCanHx = this.data.zt_open_hx == '1' ? true : false
      }
      if (postData.peisongType == 'zq' && this.data.shops) {
        postData.shopIdZt = this.data.shops[this.data.shopIndex].id
        postData.shopNameZt = this.data.shops[this.data.shopIndex].name
      }
      postData.extJsonStr = JSON.stringify(extJsonStr)
    }
    const shopList = this.data.shopList
    let totalRes = {
      code: 0,
      msg: 'success',
      data: {
        score: 0,
        amountReal: 0,
        orderIds: []
      }
    }
    if (shopList && shopList.length > 1) {
      // 多门店的商品下单
      let totalScoreToPay = 0
      let isNeedLogistics = false
      let allGoodsAndYunPrice = 0
      let yunPrice = 0
      let amountLogistics2 = 0
      let deductionMoney = 0
      let couponAmount = 0
      let disabledBuy = false
      let goodsAdditionalPriceMap = {}
      for (let index = 0; index < shopList.length; index++) {
        const curShop = shopList[index]
        postData.filterShopId = curShop.id
        if (curShop.curCoupon) {
          postData.couponId = curShop.curCoupon.id
        } else {
          postData.couponId = ''
        }
        const res = await WXAPI.orderCreate(postData)
        this.data.pageIsEnd = true
        if (res.code != 0) {
          this.data.pageIsEnd = false
          wx.showModal({
            title: '错误',
            content: res.msg,
            showCancel: false
          })
          this.setData({
            btnLoading: false
          })
          return;
        }
        totalRes.data.score += res.data.score
        totalRes.data.amountReal += res.data.amountReal
        totalRes.data.orderIds.push(res.data.id)
        if (!e) {
          curShop.hasNoCoupons = true
          if (res.data.couponUserList) {
            curShop.hasNoCoupons = false
            res.data.couponUserList.forEach(ele => {
              let moneyUnit = '元'
              if (ele.moneyType == 1) {
                moneyUnit = '%'
              }
              if (ele.moneyHreshold) {
                ele.nameExt = ele.name + ' [面值' + ele.money + moneyUnit + '，满' + ele.moneyHreshold + '元可用]'
              } else {
                ele.nameExt = ele.name + ' [面值' + ele.money + moneyUnit + ']'
              }
            })
            curShop.curCouponShowText = '请选择使用优惠券'
            curShop.coupons = res.data.couponUserList
            if (res.data.couponId && res.data.couponId.length > 0) {
              curShop.curCoupon = curShop.coupons.find(ele => { return ele.id == res.data.couponId[0] })
              curShop.curCouponShowText = curShop.curCoupon.nameExt
            }
          }
          shopList.splice(index, 1, curShop)
          // 计算积分抵扣规则 userScore
          let scoreDeductionRules = res.data.scoreDeductionRules
          if (scoreDeductionRules) {
            // 如果可叠加，计算可抵扣的最大积分数
            scoreDeductionRules.forEach(ele => {
              if (ele.loop) {
                let loopTimes = Math.floor(this.data.userScore / ele.score) // 按剩余积分取最大
                let loopTimesMax = Math.floor((res.data.amountTotle + res.data.deductionMoney) / ele.money) // 按金额取最大
                if (loopTimes > loopTimesMax) {
                  loopTimes = loopTimesMax
                }
                ele.score = ele.score * loopTimes
                ele.money = ele.money * loopTimes
              }
            })
            // 剔除积分数为0的情况
            scoreDeductionRules = scoreDeductionRules.filter(ele => {
              return ele.score > 0
            })
            curShop.scoreDeductionRules = scoreDeductionRules
            shopList.splice(index, 1, curShop)
          }
          totalScoreToPay += res.data.score
          if (res.data.isNeedLogistics) {
            isNeedLogistics = true
          }
          allGoodsAndYunPrice += res.data.amountReal
          yunPrice += res.data.amountLogistics
          amountLogistics2 += res.data.amountLogistics2 || 0
          deductionMoney += res.data.deductionMoney
          couponAmount += res.data.couponAmount
          goodsAdditionalPriceMap = Object.assign(goodsAdditionalPriceMap, res.data.goodsAdditionalPriceMap)
        }
      }
      const buttonStatus = this.calculateButtonStatus(allGoodsAndYunPrice)
      this.setData({
        disabledBuy: buttonStatus.disabledBuy,
        deliveryButtonText: buttonStatus.buttonText,
        shopList,
        totalScoreToPay,
        isNeedLogistics,
        allGoodsAndYunPrice,
        goodsAdditionalPriceMap,
        yunPrice,
        amountLogistics2,
        hasNoCoupons: true,
        deductionMoney,
        couponAmount
      });
    } else {
      // 单门店单商品下单
      if (shopList && shopList.length == 1) {
        if (shopList[0].curCoupon) {
          postData.couponId = shopList[0].curCoupon.id
        } else {
          postData.couponId = ''
        }
      }
      const res = await WXAPI.orderCreate(postData)
      this.data.pageIsEnd = true
      if (res.code != 0) {
        this.data.pageIsEnd = false
        wx.showModal({
          title: '错误',
          content: res.msg,
          showCancel: false
        })
        this.setData({
          btnLoading: false
        })
        return;
      }
      totalRes = res
      if (!e) {
        let hasNoCoupons = true
        let coupons = null
        if (res.data.couponUserList) {
          hasNoCoupons = false
          res.data.couponUserList.forEach(ele => {
            let moneyUnit = '元'
            if (ele.moneyType == 1) {
              moneyUnit = '%'
            }
            if (ele.moneyHreshold) {
              ele.nameExt = ele.name + ' [面值' + ele.money + moneyUnit + '，满' + ele.moneyHreshold + '元可用]'
            } else {
              ele.nameExt = ele.name + ' [面值' + ele.money + moneyUnit + ']'
            }
          })
          coupons = res.data.couponUserList
          if (shopList && shopList.length == 1 && !hasNoCoupons) {
            hasNoCoupons = true
            const curShop = shopList[0]
            curShop.hasNoCoupons = false
            curShop.curCouponShowText = '请选择使用优惠券'
            curShop.coupons = res.data.couponUserList
            if (res.data.couponId && res.data.couponId.length > 0) {
              curShop.curCoupon = curShop.coupons.find(ele => { return ele.id == res.data.couponId[0] })
              curShop.curCouponShowText = curShop.curCoupon.nameExt
            }
            shopList[0] = curShop
          }
        }
        // 计算积分抵扣规则 userScore
        let scoreDeductionRules = res.data.scoreDeductionRules
        if (scoreDeductionRules) {
          // 如果可叠加，计算可抵扣的最大积分数
          scoreDeductionRules.forEach(ele => {
            if (ele.loop) {
              let loopTimes = Math.floor(this.data.userScore / ele.score) // 按剩余积分取最大
              let loopTimesMax = Math.floor((res.data.amountTotle + res.data.deductionMoney) / ele.money) // 按金额取最大
              if (loopTimes > loopTimesMax) {
                loopTimes = loopTimesMax
              }
              ele.score = ele.score * loopTimes
              ele.money = ele.money * loopTimes
            }
          })
          // 剔除积分数为0的情况
          scoreDeductionRules = scoreDeductionRules.filter(ele => {
            return ele.score > 0
          })
        }
        const buttonStatus = this.calculateButtonStatus(res.data.amountReal)
        this.setData({
          disabledBuy: buttonStatus.disabledBuy,
          deliveryButtonText: buttonStatus.buttonText,
          shopList,
          totalScoreToPay: res.data.score,
          isNeedLogistics: res.data.isNeedLogistics,
          allGoodsAndYunPrice: res.data.amountReal,
          goodsAdditionalPriceMap: res.data.goodsAdditionalPriceMap,
          yunPrice: res.data.amountLogistics,
          amountLogistics2: res.data.amountLogistics2,
          hasNoCoupons,
          coupons,
          deductionMoney: res.data.deductionMoney,
          couponAmount: res.data.couponAmount,
          scoreDeductionRules
        })
      }
    }
    if (!e) {
      this.data.pageIsEnd = false
      return
    }
    if (e && "buyNow" != this.data.orderType) {
      // 清空购物车数据
      const keyArrays = []
      this.data.goodsList.forEach(ele => {
        keyArrays.push(ele.key)
      })
      if (this.data.shopCarType == 0) { //自营购物车
        WXAPI.shippingCarInfoRemoveItem(loginToken, keyArrays.join())
      } else if (this.data.shopCarType == 1) {//云货架购物车
        WXAPI.jdvopCartRemoveV2(loginToken, keyArrays.join())
      }
    }
    this.processAfterCreateOrder(totalRes)
  },
  async processAfterCreateOrder(res) {
    this.setData({
      btnLoading: false
    })
    if (res.data.status != 0) {
      wx.redirectTo({
        url: "/pages/order-list/index"
      })
      return
    }
    let orderId = ''
    if (res.data.orderIds && res.data.orderIds.length > 0) {
      orderId = res.data.orderIds.join()
    } else {
      orderId = res.data.id
    }
    // 直接弹出支付，取消支付的话，去订单列表
    await this.userAmount()
    const balance = this.data.balance
    const userScore = this.data.userScore
    if (userScore < res.data.score) {
      wx.showModal({
        title: '提示',
        content: '您当前可用积分不足，请稍后前往订单管理进行支付',
        showCancel: false,
        success: res2 => {
          wx.redirectTo({
            url: "/pages/order-list/index"
          })
        }
      })
      return
    }
    if (balance || res.data.amountReal * 1 == 0) {
      // 有余额
      const money = (res.data.amountReal * 1 - balance * 1).toFixed(2)
      if (money <= 0) {
        // 余额足够
        wx.showModal({
          title: '请确认支付',
          content: `您当前可用余额¥${balance}，使用余额支付¥${res.data.amountReal}？`,
          confirmText: "确认支付",
          cancelText: "暂不付款",
          success: res2 => {
            if (res2.confirm) {
              // 使用余额支付
              WXAPI.orderPay(wx.getStorageSync('token'), orderId).then(res3 => {
                if (res3.code != 0) {
                  wx.showToast({
                    title: res3.msg,
                    icon: 'none'
                  })
                  return
                }
                wx.redirectTo({
                  url: "/pages/order-list/index"
                })
              })
            } else {
              wx.redirectTo({
                url: "/pages/order-list/index"
              })
            }
          }
        })
      } else {
        // 余额不够
        wx.showModal({
          title: '请确认支付',
          content: `您当前可用余额¥${balance}，仍需支付¥${money}`,
          confirmText: "确认支付",
          cancelText: "暂不付款",
          success: res2 => {
            if (res2.confirm) {
              // 使用余额支付
              this.setData({
                orderId,
                money,
                paymentShow: true,
                nextAction: {
                  type: 0,
                  id: orderId
                }
              })
            } else {
              wx.redirectTo({
                url: "/pages/order-list/index"
              })
            }
          }
        })
      }
    } else {
      // 没余额
      this.setData({
        orderId,
        money: res.data.amountReal,
        paymentShow: true,
        nextAction: {
          type: 0,
          id: orderId
        }
      })
    }
  },
  // 计算两个经纬度点之间的距离（单位：公里）
  calculateDistance(lat1, lng1, lat2, lng2) {
    const radLat1 = (lat1 * Math.PI) / 180;
    const radLat2 = (lat2 * Math.PI) / 180;
    const deltaLat = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLng = ((lng2 - lng1) * Math.PI) / 180;
    
    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
              Math.cos(radLat1) * Math.cos(radLat2) *
              Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = 6371 * c; // 地球半径约为6371公里
    
    return distance;
  },

  // 计算按钮禁用状态和显示文本
  calculateButtonStatus(amountReal) {
    let disabledBuy = false;
    let buttonText = '提交订单';
    
    if (this.data.peisongType === 'kd') {
      // 快递模式下的状态判断 - 配送状态优先于起送价
      switch (this.data.deliveryStatus) {
        case 'outOfRange':
          disabledBuy = true;
          buttonText = this.data.deliveryMessage || '超配送范围';
          break;
        case 'belowMinimum':
          disabledBuy = true;
          buttonText = this.data.deliveryMessage || '未达起送价';
          break;
        case 'normal':
          // 配送正常，但仍需检查起送价
          const qisongjiaForNormal = Number(this.data.qisongjia);
          if (qisongjiaForNormal > 0 && qisongjiaForNormal > amountReal) {
            disabledBuy = true;
            buttonText = `¥${qisongjiaForNormal} 起送`;
          } else {
            disabledBuy = false;
            buttonText = '提交订单';
          }
          break;
        default:
          // 未设置配送状态时，检查起送价（向后兼容）
          const qisongjia = Number(this.data.qisongjia);
          if (qisongjia > 0 && qisongjia > amountReal) {
            disabledBuy = true;
            buttonText = `¥${qisongjia} 起送`;
          }
          break;
      }
    } else if (this.data.peisongType === 'zq') {
      // 自取模式：不受起送价限制，直接允许下单
      disabledBuy = false;
      buttonText = '提交订单';
    } else {
      // 其他模式保持原有逻辑
      const qisongjia = Number(this.data.qisongjia);
      if (qisongjia > 0 && qisongjia > amountReal) {
        disabledBuy = true;
        buttonText = `¥${qisongjia} 起送`;
      }
    }
    
    return { disabledBuy, buttonText };
  },

  // 验证配送范围和获取可用门店
  async validateDeliveryRange() {
    if (this.data.peisongType !== 'kd') {
      return;
    }

    // 如果没有用户坐标但有地址，尝试获取坐标
    if ((!this.data.userLatitude || !this.data.userLongitude) && this.data.curAddressData && this.data.curAddressData.address) {
      const location = await this.getLocationByAddress(this.data.curAddressData.address);
      this.setData({
        userLatitude: location.latitude,
        userLongitude: location.longitude
      });
    }

    // 获取所有门店
    const shopRes = await WXAPI.fetchShops();
    
    if (shopRes.code !== 0 || !shopRes.data || shopRes.data.length === 0) {
      this.setData({
        deliveryStatus: 'outOfRange',
        deliveryMessage: '暂无可配送门店',
        availableShops: []
      });
      return;
    }

    // 过滤正常状态的门店并计算距离
    const availableShops = [];

    shopRes.data.forEach(shop => {
      // 检查门店状态
      if (shop.statusStr !== '正常' || shop.status !== 1) {
        return;
      }

      // 检查门店是否有经纬度信息
      if (!shop.latitude || !shop.longitude) {
        return;
      }

      // 计算距离
      const distance = this.calculateDistance(
        this.data.userLatitude,
        this.data.userLongitude,
        shop.latitude,
        shop.longitude
      );

      // 检查是否在配送范围内（serviceDistance单位假设为公里）
      const serviceDistance = shop.serviceDistance || 0;

      if (serviceDistance > 0 && distance <= serviceDistance) {
        shop.distanceToUser = distance;
        availableShops.push(shop);
      }
    });

    this.setData({
      availableShops
    });

    // 根据可用门店数量设置配送状态
    if (availableShops.length === 0) {
      this.setData({
        deliveryStatus: 'outOfRange',
        deliveryMessage: '超出配送范围'
      });
    } else {
      // 有可配送门店，设置为正常配送状态
      // 起送价检查将在calculateButtonStatus()中统一处理
      this.setData({
        deliveryStatus: 'normal',
        deliveryMessage: ''
      });
    }
  },

  // 通过地址获取经纬度
  async getLocationByAddress(address) {
    return new Promise((resolve, reject) => {
      if (!address) {
        resolve({ latitude: null, longitude: null });
        return;
      }
      
      // 如果没有经纬度信息，尝试通过微信小程序的地理编码能力获取
      // 注意：这里简化处理，实际项目中应该根据具体地址进行地理编码
      // 可以接入腾讯地图、百度地图或高德地图的地理编码API
      wx.getLocation({
        type: 'gcj02',
        success: (res) => {
          // 获取用户当前位置作为默认位置
          // 在实际项目中，应该根据具体地址进行地理编码
          resolve({
            latitude: res.latitude,
            longitude: res.longitude
          });
        },
        fail: (error) => {
          // 如果获取位置失败，返回null
          resolve({ latitude: null, longitude: null });
        }
      });
    });
  },

  async initShippingAddress() {
    const res = await WXAPI.defaultAddress(wx.getStorageSync('token'))
    
    if (res.code == 0) {
      this.setData({
        curAddressData: res.data.info
      });
      
      // 获取地址经纬度
      if (res.data.info && res.data.info.address) {
        const location = await this.getLocationByAddress(res.data.info.address);
        
        this.setData({
          userLatitude: location.latitude,
          userLongitude: location.longitude
        });
        
        // 验证配送范围
        await this.validateDeliveryRange();
      }
    } else {
      this.setData({
        curAddressData: null,
        userLatitude: null,
        userLongitude: null
      });
    }
    this.processYunfei();
  },
  processYunfei() {
    var goodsList = this.data.goodsList
    if (goodsList.length == 0) {
      return
    }
    const goodsJsonStr = []
    var isNeedLogistics = 0;

    let inviter_id = 0;
    let inviter_id_storge = wx.getStorageSync('referrer');
    if (inviter_id_storge) {
      inviter_id = inviter_id_storge;
    }
    for (let i = 0; i < goodsList.length; i++) {
      let carShopBean = goodsList[i];
      if (carShopBean.logistics || carShopBean.logisticsId) {
        isNeedLogistics = 1;
      }

      const _goodsJsonStr = {
        propertyChildIds: carShopBean.propertyChildIds
      }
      if (carShopBean.sku && carShopBean.sku.length > 0) {
        let propertyChildIds = ''
        carShopBean.sku.forEach(option => {
          propertyChildIds = propertyChildIds + ',' + option.optionId + ':' + option.optionValueId
        })
        _goodsJsonStr.propertyChildIds = propertyChildIds
      }
      if (carShopBean.additions && carShopBean.additions.length > 0) {
        let goodsAdditionList = []
        carShopBean.additions.forEach(option => {
          goodsAdditionList.push({
            pid: option.pid,
            id: option.id
          })
        })
        _goodsJsonStr.goodsAdditionList = goodsAdditionList
      }
      _goodsJsonStr.goodsId = carShopBean.goodsId
      _goodsJsonStr.number = carShopBean.number
      _goodsJsonStr.logisticsType = 0
      _goodsJsonStr.inviter_id = inviter_id
      goodsJsonStr.push(_goodsJsonStr)

    }
    if (this.data.shopCarType == 1) {
      // vop 商品必须快递
      isNeedLogistics = 1
    }
    this.setData({
      isNeedLogistics: isNeedLogistics,
      goodsJsonStr: JSON.stringify(goodsJsonStr)
    });
    this.createOrder();
  },
  addAddress: function () {
    wx.navigateTo({
      url: "/pages/address-add/index"
    })
  },
  selectAddress: function () {
    wx.navigateTo({
      url: "/pages/select-address/index"
    })
  },
  bindChangeCoupon: function (e) {
    const selIndex = e.detail.value;
    this.setData({
      curCoupon: this.data.coupons[selIndex],
      curCouponShowText: this.data.coupons[selIndex].nameExt
    });
    this.processYunfei()
  },
  bindChangeCouponShop: function (e) {
    const selIndex = e.detail.value;
    const shopIndex = e.currentTarget.dataset.sidx
    const shopList = this.data.shopList
    const curshop = shopList[shopIndex]
    curshop.curCoupon = curshop.coupons[selIndex]
    curshop.curCouponShowText = curshop.coupons[selIndex].nameExt
    shopList.splice(shopIndex, 1, curshop)
    this.setData({
      shopList
    });
    this.processYunfei()
  },
  async radioChange(e) {
    this.setData({
      peisongType: e.detail.value
    })
    
    if (e.detail.value == 'zq') {
      // 自取模式：获取门店列表供用户选择
      // 清除快递模式的配送状态
      this.setData({
        deliveryStatus: '',
        deliveryMessage: '',
        deliveryButtonText: ''
      });
      this.fetchShops()
    } else if (e.detail.value == 'kd') {
      // 快递模式：验证配送范围
      
      // 如果没有用户坐标，先获取地址经纬度
      if (!this.data.userLatitude || !this.data.userLongitude) {
        // 重新获取默认地址和经纬度
        const res = await WXAPI.defaultAddress(wx.getStorageSync('token'))
        if (res.code == 0 && res.data.info && res.data.info.address) {
          // 更新地址数据
          this.setData({
            curAddressData: res.data.info
          });
          
          // 获取经纬度
          const location = await this.getLocationByAddress(res.data.info.address);
          
          this.setData({
            userLatitude: location.latitude,
            userLongitude: location.longitude
          });
        }
      }
      
      // 验证配送范围
      await this.validateDeliveryRange()
    }
    
    this.processYunfei()
  },
  dyChange(e) {
    this.setData({
      dyopen: e.detail.value
    })
  },
  dyunitChange(e) {
    this.setData({
      dyunit: e.detail.value
    })
  },
  cancelLogin() {
    wx.navigateBack()
  },
  async fetchShops() {
    const res = await WXAPI.fetchShops()
    if (res.code == 0) {
      let shopIndex = this.data.shopIndex
      const shopInfo = wx.getStorageSync('shopInfo')
      if (shopInfo) {
        shopIndex = res.data.findIndex(ele => {
          return ele.id == shopInfo.id
        })
      }
      this.setData({
        shops: res.data,
        shopIndex
      })
    }
  },
  shopSelect(e) {
    this.setData({
      shopIndex: e.detail.value
    })
  },
  goMap() {
    const _this = this
    const shop = this.data.shops[this.data.shopIndex]
    const latitude = shop.latitude
    const longitude = shop.longitude
    wx.openLocation({
      latitude,
      longitude,
      scale: 18
    })
  },
  callMobile() {
    const shop = this.data.shops[this.data.shopIndex]
    wx.makePhoneCall({
      phoneNumber: shop.linkPhone,
    })
  },
  async getUserApiInfo() {
    const res = await WXAPI.userDetail(wx.getStorageSync('token'))
    if (res.code == 0) {
      let bindMobileStatus = res.data.base.mobile ? 1 : 2 // 账户绑定的手机号码状态
      if (this.data.needBindMobile != 1) {
        bindMobileStatus = 1
      }
      this.setData({
        bindMobileStatus,
        mobile: res.data.base.mobile,
        name: res.data.base.nick,
      })
    }
  },
  bindMobile() {
    this.setData({
      bindMobileShow: true
    })
  },
  bindMobileOk(e) {
    this.setData({
      bindMobileShow: false,
      mobile: e.detail.mobile,
      bindMobileStatus: 1
    })
  },
  bindMobileCancel() {
    this.setData({
      bindMobileShow: false
    })
  },
  deductionScoreChange(event) {
    this.setData({
      deductionScore: event.detail,
    })
    this.processYunfei()
  },
  deductionScoreClick(event) {
    const {
      name
    } = event.currentTarget.dataset;
    this.setData({
      deductionScore: name,
    })
    this.processYunfei()
  },
  cardChange(event) {
    this.setData({
      cardId: event.detail,
    })
    this.processYunfei()
  },
  cardClick(event) {
    const {
      name
    } = event.currentTarget.dataset;
    this.setData({
      cardId: name,
    })
    this.processYunfei()
  },
  dateStartclick(e) {
    this.setData({
      dateStartpop: true
    })
  },
  dateStartconfirm(e) {
    const d = new Date(e.detail)
    this.setData({
      dateStart: d.format('yyyy-MM-dd h:m:s'),
      dateStartpop: false
    })
  },
  dateStartcancel(e) {
    this.setData({
      dateStartpop: false
    })
  },
  async cardMyList() {
    const res = await WXAPI.cardMyList(wx.getStorageSync('token'))
    if (res.code == 0) {
      const myCards = res.data.filter(ele => { return ele.status == 0 && ele.amount > 0 && ele.cardInfo.refs })
      if (myCards.length > 0) {
        this.setData({
          myCards: res.data
        })
      }
    }
  },
  // 🧪 测试方法：快速测试配送状态和起送价
  testDeliveryStatus() {
    // 测试按钮状态计算
    const buttonStatus = this.calculateButtonStatus(this.data.allGoodsAndYunPrice);
    
    // 应用结果
    this.setData({
      disabledBuy: buttonStatus.disabledBuy,
      deliveryButtonText: buttonStatus.buttonText
    });
    
    wx.showToast({
      title: buttonStatus.buttonText,
      icon: 'none',
      duration: 2000
    });
  },

  // 🧪 测试方法：模拟在配送范围内
  testInRange() {
    this.setData({
      deliveryStatus: 'normal',
      deliveryMessage: ''
    });
    this.testDeliveryStatus();
  },

  // 🧪 测试方法：模拟超出配送范围
  testOutOfRange() {
    this.setData({
      deliveryStatus: 'outOfRange',
      deliveryMessage: '超出配送范围'
    });
    this.testDeliveryStatus();
  },

  paymentOk(e) {
    this.setData({
      paymentShow: false
    })
    wx.redirectTo({
      url: '/pages/order-list/index',
    })
  },
  paymentCancel() {
    this.setData({
      paymentShow: false
    })
  },
  extRequiredChange(e) {
    let extRequiredMap = this.data.extRequiredMap
    if (!extRequiredMap) {
      extRequiredMap = {}
    }
    extRequiredMap[e.target.dataset.name] = e.detail
    this.setData({
      extRequiredMap
    })
  },
})