document.addEventListener('DOMContentLoaded', function() {
    // 下载按钮点击动画
    const downloadButtons = document.querySelectorAll('.download-btn');
    
    downloadButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            // 添加点击效果
            this.style.transform = 'translateY(2px)';
            
            // 创建下载动画元素
            const downloadAnim = document.createElement('div');
            downloadAnim.className = 'download-animation';
            downloadAnim.innerHTML = '<i class="fas fa-cloud-download-alt"></i>';
            
            // 设置动画位置
            const rect = this.getBoundingClientRect();
            downloadAnim.style.left = rect.left + rect.width/2 + 'px';
            downloadAnim.style.top = rect.top + 'px';
            
            document.body.appendChild(downloadAnim);
            
            // 动画结束后移除元素
            setTimeout(() => {
                downloadAnim.style.transform = 'translateY(-100px)';
                downloadAnim.style.opacity = '0';
                
                setTimeout(() => {
                    document.body.removeChild(downloadAnim);
                }, 500);
            }, 10);
        });
    });
    
    // 添加样式到头部
    const style = document.createElement('style');
    style.textContent = `
        .download-animation {
            position: fixed;
            font-size: 24px;
            color: #3a86ff;
            z-index: 1000;
            pointer-events: none;
            animation: downloadFly 1s ease-out forwards;
        }
        
        @keyframes downloadFly {
            0% {
                transform: translateY(0) scale(1);
                opacity: 1;
            }
            100% {
                transform: translateY(-100px) scale(1.5);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(style);
});