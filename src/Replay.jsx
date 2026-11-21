import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

export function Replay({ step, approved, outgoing, approvedAmount, outgoingAmount, matches }) {
  const host = useRef(null);
  useEffect(() => {
    const element = host.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      element.hidden = true;
      return;
    }
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-5, 5, 2.8, -2.8, 0.1, 50);
    camera.position.set(4, 11, 7);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xfff6dd, 0x6c8775, 2));
    const light = new THREE.DirectionalLight(0xfff0cf, 2);
    light.position.set(-5, 8, 4);
    scene.add(light);
    function slip(title, payment, amount, tint) {
      const group = new THREE.Group();
      const paper = new THREE.Mesh(new THREE.BoxGeometry(2.85, 0.075, 3.7), new THREE.MeshStandardMaterial({ color: 0xfffcf1 }));
      group.add(paper);
      const canvas = document.createElement('canvas');
      canvas.width = 384;
      canvas.height = 512;
      const ink = canvas.getContext('2d');
      ink.fillStyle = '#fbf8e9';
      ink.fillRect(0, 0, 384, 512);
      ink.fillStyle = '#275544';
      ink.fillRect(0, 0, 384, 9);
      ink.font = 'bold 25px system-ui';
      ink.fillText(title, 34, 70);
      ink.font = '17px system-ui';
      ink.fillText('BENEFICIARY INSTRUCTION', 34, 112);
      ink.font = '18px system-ui';
      ink.fillText(payment.beneficiary, 34, 153, 315);
      ink.fillText(payment.reference, 34, 184, 315);
      ink.font = 'bold 25px monospace';
      ink.fillText(amount, 34, 225, 315);
      ink.fillStyle = tint;
      ink.fillRect(24, 260, 336, 112);
      ink.fillStyle = '#23392f';
      ink.font = 'bold 18px system-ui';
      ink.fillText('ACCOUNT NUMBER', 40, 294);
      ink.font = 'bold 44px monospace';
      ink.fillText('••' + payment.account, 40, 346);
      ink.font = '18px system-ui';
      ink.fillText('BANK ' + payment.bank, 34, 421);
      const map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      const printed = new THREE.Mesh(new THREE.PlaneGeometry(2.78, 3.62), new THREE.MeshBasicMaterial({ map }));
      printed.rotation.x = -Math.PI / 2;
      printed.position.y = 0.041;
      group.add(printed);
      scene.add(group);
      return group;
    }
    const approvedSlip = slip('Approved instruction', approved, approvedAmount, '#d7e8d9');
    const outgoingSlip = slip('Final payment file', outgoing, outgoingAmount, matches ? '#d7e8d9' : '#f6d88d');
    const target = step === 0 ? 0.85 : 1.85;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.append(renderer.domElement);
    let frame;
    function draw(progress) {
      approvedSlip.position.set(-progress, 0, 0);
      outgoingSlip.position.set(progress, step === 0 ? 0.42 : 0.16, 0);
      outgoingSlip.rotation.y = step === 0 ? -0.12 : 0;
      renderer.render(scene, camera);
    }
    const resize = new ResizeObserver(() => {
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      const aspect = element.clientWidth / element.clientHeight;
      camera.left = -Math.max(4.1, 2.8 * aspect);
      camera.right = -camera.left;
      camera.top = camera.right / aspect;
      camera.bottom = -camera.top;
      camera.updateProjectionMatrix();
      renderer.setSize(element.clientWidth, element.clientHeight);
      draw(target);
    });
    resize.observe(element);
    if (!reduced) {
      const started = performance.now();
      function animate(now) {
        const t = Math.min((now - started) / 550, 1);
        draw(0.85 + (target - 0.85) * (1 - (1 - t) ** 3));
        if (t < 1) frame = requestAnimationFrame(animate);
      }
      frame = requestAnimationFrame(animate);
    }
    return () => {
      resize.disconnect();
      cancelAnimationFrame(frame);
      scene.traverse(object => {
        object.geometry?.dispose();
        object.material?.map?.dispose();
        object.material?.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [step, approved, outgoing, approvedAmount, outgoingAmount, matches]);
  return <div className="scene" ref={host} aria-hidden="true" />;
}
