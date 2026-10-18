if (window.localStorage.getItem("fpson") == undefined || window.localStorage.getItem("fpson") == "1") {
    var rAF = function () {
        return (
            window.requestAnimationFrame ||
            window.webkitRequestAnimationFrame ||
            function (callback) {
                window.setTimeout(callback, 1000 / 60);
            }
        );
    }();
    var frame = 0;
    var lastTime = performance.now();
    // 首屏解析脚本、解码图片、首次绘制会天然掉帧，
    // 前 2 秒不计入结果，避免误报「电竞级帧率」
    var warmupUntil = lastTime + 2000;
    var lowCount = 0;
    var goodCount = 0;
    var lowPerf = false;

    var setLowPerf = function (on) {
        if (lowPerf === on) return;
        lowPerf = on;
        document.documentElement.classList.toggle("low-perf", on);
    };

    var loop = function (now) {
        now = now || performance.now();
        frame++;

        var elapsed = now - lastTime;
        if (elapsed < 1000) {
            rAF(loop);
            return;
        }

        var fps = Math.round((frame * 1000) / elapsed);
        frame = 0;
        lastTime = now;

        if (now < warmupUntil) {
            rAF(loop);
            return;
        }

        if (fps <= 5) {
            var kd = `<span style="color:#bd0000">卡成ppt🤢</span>`
        } else if (fps <= 15) {
            var kd = `<span style="color:red">电竞级帧率😖</span>`
        } else if (fps <= 25) {
            var kd = `<span style="color:orange">有点难受😨</span>`
        } else if (fps < 35) {
            var kd = `<span style="color:#9338e6">不太流畅🙄</span>`
        } else if (fps <= 45) {
            var kd = `<span style="color:#08b7e4">还不错哦😁</span>`
        } else {
            var kd = `<span style="color:#39c5bb">十分流畅🤣</span>`
        }
        document.getElementById("fps").innerHTML = `FPS:${fps} ${kd}`;

        // 连续 3 秒低于 30 帧：开启低性能模式（停装饰动画、关毛玻璃）
        // 连续 5 秒回到 50 帧以上：恢复效果
        if (fps < 30) {
            lowCount++;
            goodCount = 0;
        } else if (fps >= 50) {
            goodCount++;
            lowCount = 0;
        } else {
            lowCount = 0;
            goodCount = 0;
        }
        if (lowCount >= 3) setLowPerf(true);
        if (goodCount >= 5) setLowPerf(false);

        rAF(loop);
    }

    // 切回标签页时重新计时，避免把后台休眠的时间算成掉帧
    document.addEventListener("visibilitychange", function () {
        if (!document.hidden) {
            frame = 0;
            lastTime = performance.now();
        }
    });

    loop(lastTime);
} else {
    document.getElementById("fps").style = "display:none!important"
}