// setInterval(() => {
//   let create_time = Math.round(new Date('2024-5-20 14:11:00').getTime() / 1000); //在此行修改建站时间
//   let timestamp = Math.round((new Date().getTime()) / 1000);
//   let second = timestamp - create_time;
//   let time = new Array(0, 0, 0, 0, 0);

//   var nol = function(h){
//     return h>9?h:'0'+h;
//   }
//   if (second >= 365 * 24 * 3600) {
//     time[0] = parseInt(second / (365 * 24 * 3600));
//     second %= 365 * 24 * 3600;
//   }
//   if (second >= 24 * 3600) {
//     time[1] = parseInt(second / (24 * 3600));
//     second %= 24 * 3600;
//   }
//   if (second >= 3600) {
//     time[2] = nol(parseInt(second / 3600));
//     second %= 3600;
//   }
//   if (second >= 60) {
//     time[3] = nol(parseInt(second / 60));
//     second %= 60;
//   }
//   if (second > 0) {
//     time[4] = nol(second);
//   }
//   if ((Number(time[2])<22) && (Number(time[2])>7)){
//     currentTimeHtml ="<img class='boardsign' src='https://img.shields.io/badge/HG的小屋-营业中-6adea8?style=social&logo=cakephp' title='距离百年老店也就差不到一百年~'><div id='runtime'>" + time[0] + ' YEAR ' + time[1] + ' DAYS ' + time[2] + ' : ' + time[3] + ' : ' + time[4] + '</div>';
//   }
//   else{
//     currentTimeHtml ="<img class='boardsign' src='https://img.shields.io/badge/HG的小屋-打烊了-6adea8?style=social&logo=coffeescript' title='这个点了应该去睡觉啦，熬夜对身体不好哦'><div id='runtime'>" + time[0] + ' YEAR ' + time[1] + ' DAYS ' + time[2] + ' : ' + time[3] + ' : ' + time[4] + '</div>';
//   }
//   document.getElementById("workboard").innerHTML = currentTimeHtml;
// }, 1000);
var now = new Date;

function createtime() {
    now.setTime(now.getTime() + 1e3);
    var e = new Date("05/20/2024 14:11:00"),
        t = Math.trunc(234e8 + (now - e) / 1e3 * 17),
        a = (t / 1496e5).toFixed(6),
        o = new Date("05/20/2024 14:11:00"),
        n = (now - o) / 1e3 / 60 / 60 / 24,
        r = Math.floor(n),
        i = (now - o) / 1e3 / 60 / 60 - 24 * r,
        s = Math.floor(i);
    1 == String(s).length && (s = "0" + s);
    var d = (now - o) / 1e3 / 60 - 1440 * r - 60 * s,
        l = Math.floor(d);
    1 == String(l).length && (l = "0" + l);
    var g = (now - o) / 1e3 - 86400 * r - 3600 * s - 60 * l,
        b = Math.round(g);
    1 == String(b).length && (b = "0" + b);
    let c = "";
    c = s < 18 && s >= 9 ? `<img class='boardsign' src='https://img.shields.io/badge/HG的小窝-营业中-6adea8?style=social&logo=cakephp' title='打工仔想摆烂赚大钱~'><br> <div style="font-size:13px;font-weight:bold">报告！本站成功运行了 ${r} 天 ${s} 小时 ${l} 分 ${b} 秒 <i id="heartbeat" class='fas fa-heartbeat'></i> <br> 旅行者 1 号当前距离地球 ${t} 千米，约为 ${a} 个天文单位 🚀</div>` : `<img class='boardsign' src='https://img.shields.io/badge/HG的小屋-打烊了-6adea8?style=social&logo=coffeescript' title='这个点了应该去睡觉啦，熬夜对身体不好哦~'><br> <div style="font-size:13px;font-weight:bold">本站居然运行了 ${r} 天 ${s} 小时 ${l} 分 ${b} 秒 <i id="heartbeat" class='fas fa-heartbeat'></i> <br> 旅行者 1 号当前距离地球 ${t} 千米，约为 ${a} 个天文单位 🚀</div>`, document.getElementById("workboard") && (document.getElementById("workboard").innerHTML = c)
}
setInterval((() => {
    createtime()
}), 1e3);
