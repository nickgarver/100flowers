// --- SHADERS ---
const vsSource = `
    attribute vec2 position;
    void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const fsSource = `
    precision highp float;
    uniform float uTime;
    uniform float uAudio; 
    uniform float uHue;
    uniform vec2 uResolution;
    uniform vec4 uTrail[128]; 

    vec3 hueRotate(vec3 col, float hue) {
        vec3 k = vec3(0.57735, 0.57735, 0.57735);
        float cosAngle = cos(hue);
        return col * cosAngle + cross(k, col) * sin(hue) + k * dot(k, col) * (1.0 - cosAngle);
    }

    float smin(float a, float b, float k) {
        float h = max(k - abs(a - b), 0.0) / k;
        return min(a, b) - h * h * k * (1.0 / 4.0);
    }

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
        vec2 uv = gl_FragCoord.xy / uResolution.xy;
        float aspect = uResolution.x / uResolution.y;
        vec2 p = (uv * 2.0 - 1.0);
        p.x *= aspect;

        float slowTime = uTime * 0.04; 
        float jitter = sin(p.y * 3.0 + uTime * 1.2) * 0.05 + cos(p.x * 2.5 - uTime * 0.9) * 0.04;

        float field = 1e10; 
        float globWidth = 0.3 + (uAudio * 0.35);

        for(float i = 0.0; i < 8.0; i++) {
            vec2 pos = vec2(sin(slowTime + i * 4.0) * 1.0, cos(slowTime * 0.7 + i * 5.0) * 0.8);
            float d = length(p - pos) - (globWidth + sin(i + slowTime) * 0.1) + jitter;
            field = smin(field, d, 0.5); 
        }

        for(int i = 0; i < 128; i++) {
            vec2 m = (uTrail[i].xy * 2.0 - 1.0);
            m.x *= aspect;
            float age = uTime - uTrail[i].z;
            if(age > 0.0 && age < 240.0) {
                float inflate = smoothstep(0.0, 10.0, age); 
                float fade = smoothstep(240.0, 200.0, age);
                float trailWidth = 0.28 * uTrail[i].w * inflate * fade * (1.0 + uAudio * 0.2);
                float d = length(p - m) - trailWidth + (jitter * fade);
                field = smin(field, d, 0.5); 
            }
        }

        vec3 pinkRed = vec3(0.968, 0.207, 0.407); 
        vec3 hotPink = vec3(1.0, 0.0, 0.4);     
        vec3 deepRed = vec3(0.7, 0.0, 0.2);       
        vec3 shadowBlue = vec3(0.2, 0.0, 0.3);   

        float lavaMask = smoothstep(0.05, -0.05, field);
        float inner = smoothstep(0.0, -0.6, field);

        vec3 col = mix(pinkRed, hotPink, inner * 0.4);
        col = mix(col, deepRed, smoothstep(0.3, 0.8, inner));
        col = mix(col, shadowBlue, smoothstep(0.8, 1.0, inner));

        col = hueRotate(col, uHue);

        vec3 white = vec3(1.0);
        vec3 finalCol = mix(white, col, lavaMask);

        float t = mod(uTime, 100.0);
        float n1 = hash(uv + vec2(t * 0.01, t * 0.02));
        float n2 = hash(uv - vec2(t * 0.015, -t * 0.01));
        float combinedNoise = (n1 + n2) * 0.5;
        finalCol -= combinedNoise * 0.12;

        gl_FragColor = vec4(finalCol, 1.0);
    }
`;

// --- MAIN LOGIC ---
window.onload = function() {
    const canvas = document.getElementById('gl-canvas');
    const audio = document.getElementById('monkey-audio');
    const gl = canvas.getContext('webgl');
    const hueSlider = document.getElementById('hue-slider');
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('toggle-btn');

    if (!gl) return;

    toggleBtn.onclick = () => {
        sidebar.classList.toggle('expanded');
        toggleBtn.innerText = sidebar.classList.contains('expanded') ? '❮' : '❯';
    };

    let audioContext, analyser, dataArray, source;
    let rawBass = 0, smoothedBass = 0, hasPlayed = false;

    const setupAudioAnalysis = () => {
        // Use webkitAudioContext for older iOS Safari compatibility
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioContextClass();
        
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256; 
        analyser.smoothingTimeConstant = 0.8;
        
        source = audioContext.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(audioContext.destination);
        dataArray = new Uint8Array(analyser.frequencyBinCount);
    };

    const playMonkey = (e) => {
        // If clicking UI/Links, don't trigger the background audio logic
        if (e.target.closest('a')) return;

        // 1. Initialize Context on first interaction
        if (!audioContext) {
            setupAudioAnalysis();
        }

        // 2. The Safari "Unlock": Resume must happen inside this function
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }

        // 3. Play the actual file if it hasn't started yet
        if (!hasPlayed) {
            audio.play()
                .then(() => { hasPlayed = true; })
                .catch(err => { 
                    console.log("Safari blocked playback:", err);
                    // If it fails, we don't set hasPlayed to true so they can try again on next tap
                });
        }
    };

    const createShader = (gl, type, source) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, source);
        gl.compileShader(s);
        return s;
    };
    const program = gl.createProgram();
    // Use the backticked strings you defined at the top of the file
    gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, vsSource));
    gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, fsSource));
    gl.linkProgram(program);
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(program, "uTime");
    const uAudio = gl.getUniformLocation(program, "uAudio");
    const uHue = gl.getUniformLocation(program, "uHue");
    const uRes = gl.getUniformLocation(program, "uResolution");
    const uTrail = gl.getUniformLocation(program, "uTrail");

    let trail = new Float32Array(128 * 4);
    let trailIdx = 0;
    const updateTrail = (x, y, intensity) => {
        let idx = trailIdx * 4;
        trail[idx] = x / window.innerWidth;
        trail[idx + 1] = 1 - (y / window.innerHeight);
        trail[idx + 2] = performance.now() * 0.001;
        trail[idx + 3] = intensity;
        trailIdx = (trailIdx + 1) % 128;
    };

    let active = false;
    const handleStart = (e) => { 
        if (e.target.closest('a')) return;
        active = true; 
        playMonkey(e); 
        input(e); 
    };
    const input = (e) => {
        const x = e.clientX || (e.touches && e.touches[0].clientX);
        const y = e.clientY || (e.touches && e.touches[0].clientY);
        if (x !== undefined) updateTrail(x, y, 1.0);
    };

    window.addEventListener('mousedown', handleStart);
    window.addEventListener('mousemove', (e) => active && input(e));
    window.addEventListener('mouseup', () => active = false);
    window.addEventListener('touchstart', (e) => handleStart(e), { passive: false });
    window.addEventListener('touchmove', (e) => active && input(e), { passive: false });
    window.addEventListener('touchend', () => active = false);

    function render(t) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);

        if (analyser) {
            analyser.getByteFrequencyData(dataArray);
            let bassSum = 0;
            for(let i = 0; i < 6; i++) bassSum += dataArray[i];
            rawBass = (bassSum / 6) / 255.0;
            smoothedBass += (rawBass - smoothedBass) * 0.15;
        }

        gl.uniform1f(uTime, t * 0.001);
        gl.uniform1f(uAudio, smoothedBass); 
        gl.uniform1f(uHue, parseFloat(hueSlider.value));
        gl.uniform2f(uRes, canvas.width, canvas.height);
        gl.uniform4fv(uTrail, trail);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
};

