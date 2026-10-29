"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import styles from "./EarthScene.module.css";

type EarthSceneProps = { className?: string };

function makeCloudTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.clearRect(0, 0, canvas.width, canvas.height);
  let seed = 702;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let index = 0; index < 190; index += 1) {
    const x = random() * canvas.width;
    const y = random() * canvas.height;
    const radiusX = 12 + random() * 55;
    const radiusY = 3 + random() * 15;
    context.save();
    context.translate(x, y);
    context.scale(1, radiusY / radiusX);
    const cloud = context.createRadialGradient(0, 0, 1, 0, 0, radiusX);
    cloud.addColorStop(0, `rgba(255,255,255,${0.12 + random() * 0.18})`);
    cloud.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = cloud;
    context.beginPath();
    context.arc(0, 0, radiusX, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function EarthScene({ className }: EarthSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.z = 4.65;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const sunlight = new THREE.DirectionalLight(0xffffff, 2.1);
    sunlight.position.set(4, 3, 5);
    scene.add(sunlight);
    const blueLight = new THREE.PointLight(0x389bff, 2);
    blueLight.position.set(-4, 1, -3);
    scene.add(blueLight);

    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(1.42, 96, 96),
      new THREE.MeshPhongMaterial({ color: 0x1674b8, shininess: 10 }),
    );
    earth.rotation.z = -0.12;
    scene.add(earth);

    const cloudTexture = makeCloudTexture();
    const clouds = new THREE.Mesh(
      new THREE.SphereGeometry(1.445, 96, 96),
      new THREE.MeshPhongMaterial({
        map: cloudTexture ?? undefined,
        color: 0xffffff,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      }),
    );
    clouds.rotation.z = earth.rotation.z;
    scene.add(clouds);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.49, 96, 96),
      new THREE.ShaderMaterial({
        vertexShader: `varying vec3 vNormal; varying vec3 vView; void main(){vec4 p=modelViewMatrix*vec4(position,1.0);vNormal=normalize(normalMatrix*normal);vView=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,
        fragmentShader: `varying vec3 vNormal; varying vec3 vView; void main(){float edge=1.0-max(dot(normalize(vNormal),normalize(vView)),0.0);gl_FragColor=vec4(0.20,0.62,1.0,pow(edge,3.0)*0.65);}`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    scene.add(atmosphere);

    const textureLoader = new THREE.TextureLoader();
    let earthTexture: THREE.Texture | undefined;
    let disposed = false;
    textureLoader.load(
      "/images/earth-blue-marble-2048.jpg",
      (texture) => {
        if (disposed) { texture.dispose(); return; }
        texture.colorSpace = THREE.SRGBColorSpace;
        earthTexture = texture;
        const material = earth.material as THREE.MeshPhongMaterial;
        material.map = texture;
        material.color.set(0xffffff);
        material.needsUpdate = true;
        setReady(true);
      },
      undefined,
      () => {},
    );

    let frame = 0;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const render = () => renderer.render(scene, camera);
    const animate = () => {
      if (!reducedMotion.matches) {
        earth.rotation.y += 0.0008;
        clouds.rotation.y += 0.0011;
      }
      render();
      if (!reducedMotion.matches && !document.hidden) frame = window.requestAnimationFrame(animate);
    };
    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      render();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    const onMotionChange = () => {
      window.cancelAnimationFrame(frame);
      if (reducedMotion.matches) render();
      else if (!document.hidden) animate();
    };
    reducedMotion.addEventListener("change", onMotionChange);
    const onVisibility = () => {
      window.cancelAnimationFrame(frame);
      if (!document.hidden) animate();
    };
    document.addEventListener("visibilitychange", onVisibility);
    resize();
    animate();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      reducedMotion.removeEventListener("change", onMotionChange);
      document.removeEventListener("visibilitychange", onVisibility);
      earth.geometry.dispose();
      (earth.material as THREE.Material).dispose();
      clouds.geometry.dispose();
      (clouds.material as THREE.Material).dispose();
      cloudTexture?.dispose();
      earthTexture?.dispose();
      atmosphere.geometry.dispose();
      (atmosphere.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div className={`${styles.scene} ${className ?? ""}`} ref={hostRef} aria-label="Rotating Earth visual">
      <div className={`${styles.fallback} ${ready ? styles.hidden : ""}`} aria-hidden="true" />
      <span className={`${styles.chip} ${styles.chipA}`} aria-hidden="true">◉ Cleaner air</span>
      <span className={`${styles.chip} ${styles.chipB}`} aria-hidden="true">✦ Smart prediction</span>
      <span className={`${styles.chip} ${styles.chipC}`} aria-hidden="true">♡ Health first</span>
    </div>
  );
}
