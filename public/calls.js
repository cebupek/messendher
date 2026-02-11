// ============ VOICE/VIDEO CALL FUNCTIONALITY ============

// Call state
let currentCall = null;
let localCallStream = null;
let peerConnection = null;
let isCallActive = false;
let isAudioMuted = false;
let isVideoMuted = false;
let mediaRecorder = null;
let recordedChunks = [];

// ICE Configuration
const iceConfiguration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Initialize call listeners
function initCallListeners() {
    if (!ws) return;
    
    ws.addEventListener('message', (event) => {
        try {
            const data = JSON.parse(event.data);
            
            switch(data.type) {
                case 'call-offer':
                    handleIncomingCall(data);
                    break;
                case 'call-answer':
                    handleCallAnswer(data);
                    break;
                case 'ice-candidate':
                    handleIceCandidate(data);
                    break;
                case 'call-end':
                    handleCallEnd(data);
                    break;
                case 'call-reject':
                    handleCallReject(data);
                    break;
                case 'call-error':
                    handleCallError(data);
                    break;
            }
        } catch (error) {
            console.error('Ошибка обработки call события:', error);
        }
    });
}

// Start voice call
async function startVoiceCall(username) {
    if (isCallActive) {
        alert('Вже є активний дзвінок');
        return;
    }
    
    try {
        // Get audio only
        localCallStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false
        });
        
        // Create peer connection
        peerConnection = new RTCPeerConnection(iceConfiguration);
        
        // Add local stream to peer connection
        localCallStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localCallStream);
        });
        
        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                sendSignal({
                    type: 'ice-candidate',
                    to: username,
                    from: currentUser.username,
                    candidate: event.candidate,
                    callId: currentCall.id
                });
            }
        };
        
        // Handle remote stream
        peerConnection.ontrack = (event) => {
            const remoteAudio = document.getElementById('remoteAudio');
            if (remoteAudio) {
                remoteAudio.srcObject = event.streams[0];
            }
        };
        
        // Create offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        // Initialize call
        currentCall = {
            id: generateId(),
            type: 'voice',
            with: username,
            initiator: true,
            startTime: Date.now()
        };
        
        // Send call offer
        sendSignal({
            type: 'call-offer',
            to: username,
            from: currentUser.username,
            callType: 'voice',
            offer: offer,
            callId: currentCall.id
        });
        
        isCallActive = true;
        showCallUI('voice', username, 'outgoing');
        
    } catch (error) {
        console.error('Помилка початку голосового дзвінка:', error);
        alert('Не вдалося почати дзвінок: ' + error.message);
        endCall();
    }
}

// Start video call
async function startVideoCall(username) {
    if (isCallActive) {
        alert('Вже є активний дзвінок');
        return;
    }
    
    try {
        // Get audio and video
        localCallStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: true
        });
        
        // Create peer connection
        peerConnection = new RTCPeerConnection(iceConfiguration);
        
        // Add local stream to peer connection
        localCallStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localCallStream);
        });
        
        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                sendSignal({
                    type: 'ice-candidate',
                    to: username,
                    from: currentUser.username,
                    candidate: event.candidate,
                    callId: currentCall.id
                });
            }
        };
        
        // Handle remote stream
        peerConnection.ontrack = (event) => {
            const remoteVideo = document.getElementById('remoteVideo');
            if (remoteVideo) {
                remoteVideo.srcObject = event.streams[0];
            }
        };
        
        // Create offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        // Initialize call
        currentCall = {
            id: generateId(),
            type: 'video',
            with: username,
            initiator: true,
            startTime: Date.now()
        };
        
        // Send call offer
        sendSignal({
            type: 'call-offer',
            to: username,
            from: currentUser.username,
            callType: 'video',
            offer: offer,
            callId: currentCall.id
        });
        
        isCallActive = true;
        showCallUI('video', username, 'outgoing');
        
        // Show local video
        const localVideo = document.getElementById('localVideo');
        if (localVideo) {
            localVideo.srcObject = localCallStream;
        }
        
    } catch (error) {
        console.error('Помилка початку відеодзвінка:', error);
        alert('Не вдалося почати дзвінок: ' + error.message);
        endCall();
    }
}

// Handle incoming call
async function handleIncomingCall(data) {
    if (isCallActive) {
        // Reject call if already in another call
        sendSignal({
            type: 'call-reject',
            to: data.from,
            from: currentUser.username,
            callId: data.callId
        });
        return;
    }
    
    // Show incoming call notification
    const accept = confirm(`📞 ${data.callType === 'video' ? '📹 Відеодзвінок' : '🔊 Голосовий дзвінок'} від ${data.from}.\n\nПрийняти дзвінок?`);
    
    if (!accept) {
        sendSignal({
            type: 'call-reject',
            to: data.from,
            from: currentUser.username,
            callId: data.callId
        });
        return;
    }
    
    try {
        // Get user media based on call type
        localCallStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: data.callType === 'video'
        });
        
        // Create peer connection
        peerConnection = new RTCPeerConnection(iceConfiguration);
        
        // Add local stream
        localCallStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localCallStream);
        });
        
        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                sendSignal({
                    type: 'ice-candidate',
                    to: data.from,
                    from: currentUser.username,
                    candidate: event.candidate,
                    callId: data.callId
                });
            }
        };
        
        // Handle remote stream
        peerConnection.ontrack = (event) => {
            if (data.callType === 'video') {
                const remoteVideo = document.getElementById('remoteVideo');
                if (remoteVideo) {
                    remoteVideo.srcObject = event.streams[0];
                }
            } else {
                const remoteAudio = document.getElementById('remoteAudio');
                if (remoteAudio) {
                    remoteAudio.srcObject = event.streams[0];
                }
            }
        };
        
        // Set remote description
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        
        // Create answer
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        // Send answer
        sendSignal({
            type: 'call-answer',
            to: data.from,
            from: currentUser.username,
            answer: answer,
            callId: data.callId
        });
        
        // Initialize call
        currentCall = {
            id: data.callId,
            type: data.callType,
            with: data.from,
            initiator: false,
            startTime: Date.now()
        };
        
        isCallActive = true;
        showCallUI(data.callType, data.from, 'incoming');
        
        // Show local video if video call
        if (data.callType === 'video') {
            const localVideo = document.getElementById('localVideo');
            if (localVideo) {
                localVideo.srcObject = localCallStream;
            }
        }
        
    } catch (error) {
        console.error('Помилка прийняття дзвінка:', error);
        alert('Не вдалося прийняти дзвінок: ' + error.message);
        endCall();
    }
}

// Handle call answer
async function handleCallAnswer(data) {
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    } catch (error) {
        console.error('Помилка обробки відповіді на дзвінок:', error);
    }
}

// Handle ICE candidate
async function handleIceCandidate(data) {
    try {
        if (peerConnection && data.candidate) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    } catch (error) {
        console.error('Помилка додавання ICE candidate:', error);
    }
}

// Handle call end
function handleCallEnd(data) {
    alert(`Дзвінок завершено ${data.from}`);
    endCall();
}

// Handle call reject
function handleCallReject(data) {
    alert(`${data.from} відхилив дзвінок`);
    endCall();
}

// Handle call error
function handleCallError(data) {
    alert('Помилка дзвінка: ' + data.error);
    endCall();
}

// End call
function endCall() {
    // Stop all media tracks
    if (localCallStream) {
        localCallStream.getTracks().forEach(track => track.stop());
        localCallStream = null;
    }
    
    // Close peer connection
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    // Notify other party if call was active
    if (isCallActive && currentCall) {
        sendSignal({
            type: 'call-end',
            to: currentCall.with,
            from: currentUser.username,
            callId: currentCall.id
        });
    }
    
    // Reset call state
    currentCall = null;
    isCallActive = false;
    isAudioMuted = false;
    isVideoMuted = false;
    
    // Hide call UI
    hideCallUI();
}

// Toggle audio mute
function toggleAudioMute() {
    if (!localCallStream) return;
    
    const audioTrack = localCallStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        isAudioMuted = !audioTrack.enabled;
        
        // Update UI
        const muteBtn = document.getElementById('muteBtn');
        if (muteBtn) {
            muteBtn.textContent = isAudioMuted ? '🔇' : '🔊';
            muteBtn.title = isAudioMuted ? 'Увімкнути мікрофон' : 'Вимкнути мікрофон';
        }
    }
}

// Toggle video mute
function toggleVideoMute() {
    if (!localCallStream || currentCall.type !== 'video') return;
    
    const videoTrack = localCallStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        isVideoMuted = !videoTrack.enabled;
        
        // Update UI
        const videoBtn = document.getElementById('videoBtn');
        if (videoBtn) {
            videoBtn.textContent = isVideoMuted ? '📹' : '📷';
            videoBtn.title = isVideoMuted ? 'Увімкнути відео' : 'Вимкнути відео';
        }
    }
}

// Show call UI
function showCallUI(callType, username, direction) {
    const callUI = document.getElementById('callUI') || createCallUI();
    const callStatus = document.getElementById('callStatus');
    const callControls = document.getElementById('callControls');
    
    callUI.classList.remove('hidden');
    callStatus.textContent = `${direction === 'outgoing' ? '📞 Дзвінок' : '📞 Дзвінок від'} ${username}`;
    
    // Update controls based on call type
    let controlsHTML = `
        <button id="muteBtn" class="call-btn" onclick="toggleAudioMute()" title="Вимкнути мікрофон">🔊</button>
    `;
    
    if (callType === 'video') {
        controlsHTML += `
            <button id="videoBtn" class="call-btn" onclick="toggleVideoMute()" title="Вимкнути відео">📷</button>
        `;
    }
    
    controlsHTML += `
        <button class="call-btn end-call-btn" onclick="endCall()" title="Завершити дзвінок">📞</button>
    `;
    
    callControls.innerHTML = controlsHTML;
    
    // Show video containers if video call
    const videoContainer = document.getElementById('videoContainer');
    if (videoContainer) {
        videoContainer.classList.toggle('hidden', callType !== 'video');
    }
    
    // Start call timer
    startCallTimer();
}

// Hide call UI
function hideCallUI() {
    const callUI = document.getElementById('callUI');
    if (callUI) {
        callUI.classList.add('hidden');
    }
    
    // Stop call timer
    stopCallTimer();
}

// Create call UI element
function createCallUI() {
    const callUI = document.createElement('div');
    callUI.id = 'callUI';
    callUI.className = 'call-ui hidden';
    callUI.innerHTML = `
        <div class="call-header">
            <div id="callStatus" class="call-status"></div>
            <div id="callTimer" class="call-timer">00:00</div>
        </div>
        <div id="videoContainer" class="video-container hidden">
            <video id="localVideo" class="local-video" autoplay muted playsinline></video>
            <video id="remoteVideo" class="remote-video" autoplay playsinline></video>
        </div>
        <audio id="remoteAudio" autoplay></audio>
        <div id="callControls" class="call-controls"></div>
    `;
    document.body.appendChild(callUI);
    return callUI;
}

// Call timer
let callTimerInterval = null;

function startCallTimer() {
    stopCallTimer();
    callTimerInterval = setInterval(() => {
        if (currentCall) {
            const duration = Math.floor((Date.now() - currentCall.startTime) / 1000);
            const minutes = Math.floor(duration / 60).toString().padStart(2, '0');
            const seconds = (duration % 60).toString().padStart(2, '0');
            const timerEl = document.getElementById('callTimer');
            if (timerEl) {
                timerEl.textContent = `${minutes}:${seconds}`;
            }
        }
    }, 1000);
}

function stopCallTimer() {
    if (callTimerInterval) {
        clearInterval(callTimerInterval);
        callTimerInterval = null;
    }
}

// ============ VOICE RECORDING ============

let isRecording = false;

// Start voice recording
async function startVoiceRecording() {
    if (isRecording) return;
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        recordedChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'audio/webm' });
            sendVoiceMessage(blob);
            stream.getTracks().forEach(track => track.stop());
        };
        
        mediaRecorder.start();
        isRecording = true;
        
        // Update UI
        const recordBtn = document.getElementById('recordVoiceBtn');
        if (recordBtn) {
            recordBtn.textContent = '⏹️';
            recordBtn.title = 'Зупинити запис';
            recordBtn.classList.add('recording');
        }
        
    } catch (error) {
        console.error('Помилка запису голосу:', error);
        alert('Не вдалося почати запис: ' + error.message);
    }
}

// Stop voice recording
function stopVoiceRecording() {
    if (!isRecording || !mediaRecorder) return;
    
    mediaRecorder.stop();
    isRecording = false;
    
    // Update UI
    const recordBtn = document.getElementById('recordVoiceBtn');
    if (recordBtn) {
        recordBtn.textContent = '🎤';
        recordBtn.title = 'Записати голосове';
        recordBtn.classList.remove('recording');
    }
}

// Toggle voice recording
function toggleVoiceRecording() {
    if (isRecording) {
        stopVoiceRecording();
    } else {
        startVoiceRecording();
    }
}

// Send voice message
function sendVoiceMessage(blob) {
    if (!currentChat) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        const message = {
            id: generateId(),
            sender: currentUser.username,
            timestamp: Date.now(),
            text: '',
            voice: {
                data: e.target.result,
                duration: 0 // Can be calculated from blob if needed
            },
            reactions: [],
            read: false
        };
        
        currentChat.messages = currentChat.messages || [];
        currentChat.messages.push(message);
        saveChats();
        renderMessages();
        
        // Send to recipient
        if (currentChat.type === 'private') {
            const recipient = currentChat.participants[0];
            sendEncryptedMessage(recipient, message);
        } else {
            broadcastToGroup(currentChat.id, message);
        }
    };
    reader.readAsDataURL(blob);
}

// Send WebRTC signal
function sendSignal(signal) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(signal));
    }
}

// Initialize calls when document is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(initCallListeners, 1000);
    });
} else {
    setTimeout(initCallListeners, 1000);
}
